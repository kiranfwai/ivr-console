import {
  claimBulkRows,
  countDialing,
  countLive,
  countPending,
  listRunningJobs,
  migrateBulkJobsFromKv,
  resetDialingRows,
  setJobStatus,
} from "./bulk";
import { getCampaign } from "./campaigns";
import { publicBaseUrl } from "./plivo";
import { fireOne } from "./bulk-runner";

/**
 * In-process bulk-call worker — CPS-paced, live-capped dial pump.
 *
 * Campaigns are dialed entirely server-side: submitting a job just inserts rows
 * with status 'running'; this pump claims pending rows (FOR UPDATE SKIP LOCKED)
 * and fires each independently. Closing the browser has no effect.
 *
 * Two independent controls (replacing the old per-job placement window):
 *   1. RATE  — the account-wide CPS token bucket (see cps.ts) gates every
 *      placeCall(), so combined initiation across ALL jobs never exceeds PLIVO_CPS.
 *   2. CEILING — each job's `concurrency` field is now reinterpreted as a cap on
 *      simultaneously-LIVE calls. We never claim past `concurrency - live`, where
 *      `live` is the DB count of rows still 'dialing'/'ok' (placed, not yet hung
 *      up). A slot frees when the hangup webhook finalizes the row — so this is a
 *      true live-call cap, not a placement window.
 *
 * State lives in Postgres, so the worker is crash-safe: on boot it migrates any
 * legacy blob jobs, resets rows stuck in 'dialing', and resumes 'running' jobs.
 *
 * Stop = set job status 'paused'. Resume = status 'running'. Both durable in DB.
 *
 * NOTE: the CPS bucket and the per-tick guards below are per-process. This is
 * correct for the single-instance systemd deploy; a multi-node setup would need
 * a shared limiter (Redis/Postgres) and a DB-derived account-wide live count.
 */

const TICK_MS = 200;
// Hard ceiling on the per-job live cap regardless of the job's `concurrency`
// setting. The real account-wide throttle is PLIVO_CPS (cps.ts).
const MAX_LIVE = Number(process.env.PLIVO_MAX_LIVE) || 500;
// A "live" row older than this is assumed to have lost its hangup callback and
// no longer counts against the cap (prevents a stuck row from stalling dialing).
const MAX_CALL_SEC = Number(process.env.PLIVO_MAX_CALL_SEC) || 180;
// Cap how many rows we move into 'dialing' per tick so we never drain the whole
// queue at once; the CPS bucket then paces the actual placeCalls.
const CLAIM_BATCH = Number(process.env.WORKER_CLAIM_BATCH) || 50;

const pumping = new Set<string>();            // jobId -> a pumpJob claim is in progress
const nextClaimAt = new Map<string, number>(); // jobId -> earliest next claim (delay pacing)
const G = globalThis as unknown as { __ivrWorkerStarted?: boolean };

export async function startWorker(): Promise<void> {
  if (G.__ivrWorkerStarted) return;
  G.__ivrWorkerStarted = true;
  try {
    await migrateBulkJobsFromKv();
  } catch (e) {
    console.error("[worker] migration failed:", e);
  }
  try {
    await recover();
  } catch (e) {
    console.error("[worker] recovery failed:", e);
  }
  const timer = setInterval(() => void tick(), TICK_MS);
  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();
}

async function recover(): Promise<void> {
  for (const job of await listRunningJobs()) {
    await resetDialingRows(job.id);
  }
}

async function tick(): Promise<void> {
  let jobs;
  try {
    jobs = await listRunningJobs();
  } catch (e) {
    console.error("[worker] tick: listRunningJobs failed:", e);
    return;
  }
  const now = Date.now();
  for (const job of jobs) {
    if (job.kind !== "call") continue; // WhatsApp jobs are browser-paced, not pumped here
    // Guard: only one pumpJob may be claiming for a given job at a time. Without
    // this, ticks every 200ms launch overlapping pumps that each read a stale
    // in-flight count and over-claim — draining the whole queue into 'dialing'
    // and blowing past the concurrency cap.
    if (pumping.has(job.id)) continue;
    pumping.add(job.id);
    void pumpJob(job, now).finally(() => pumping.delete(job.id));
  }
}

async function pumpJob(
  job: { id: string; campaignId: string; concurrency: number; delayMs: number },
  now: number,
): Promise<void> {
  // `concurrency` is now the cap on simultaneously-LIVE calls for this job.
  const cap = Math.min(Math.max(1, job.concurrency), MAX_LIVE);

  // Optional inter-claim pacing on top of the CPS bucket (delayMs=0 → CPS only).
  if (job.delayMs && (nextClaimAt.get(job.id) ?? 0) > now) {
    await maybeComplete(job.id);
    return;
  }

  // Live-call ceiling: never place past `cap - live`. A slot frees when the
  // hangup webhook finalizes a row (or it ages out of the live window).
  let live: number;
  try {
    live = await countLive(job.id, MAX_CALL_SEC);
  } catch (e) {
    console.error(`[worker] live count failed for ${job.id}:`, e);
    return;
  }
  const headroom = cap - live;
  if (headroom <= 0) return; // at the live cap; wait for hangups to free slots

  const want = Math.min(headroom, CLAIM_BATCH);
  let claimed;
  try {
    claimed = await claimBulkRows(job.id, want);
  } catch (e) {
    console.error(`[worker] claim failed for ${job.id}:`, e);
    return;
  }
  if (!claimed.length) {
    await maybeComplete(job.id);
    return;
  }

  const campaign = await getCampaign(job.campaignId);
  if (!campaign) {
    console.error(`[worker] job ${job.id}: campaign ${job.campaignId} not found — pausing`);
    // Put the claimed rows back and pause so it stops trying.
    await resetDialingRows(job.id);
    await setJobStatus(job.id, "paused");
    return;
  }

  if (job.delayMs) nextClaimAt.set(job.id, Date.now() + job.delayMs);
  const base = publicBaseUrl();

  // Fire independently; placeCall() self-paces on the CPS bucket. No in-memory
  // in-flight counter — the live ceiling is derived from the DB each tick.
  for (const row of claimed) {
    void fireOne(job.id, row, campaign, base).catch((e) =>
      console.error(`[worker] fireOne error ${job.id}#${row.index}:`, e),
    );
  }
}

/**
 * Mark a job completed once nothing is left to place: no 'pending' rows and no
 * rows still 'dialing'. Calls that are merely 'live' (placed, awaiting hangup)
 * do not block completion — the job is "done dialing", and the hangup webhooks
 * keep finalizing those rows afterward.
 */
async function maybeComplete(jobId: string): Promise<void> {
  try {
    if ((await countPending(jobId)) === 0 && (await countDialing(jobId)) === 0) {
      await setJobStatus(jobId, "completed");
      nextClaimAt.delete(jobId);
    }
  } catch (e) {
    console.error(`[worker] completion check failed for ${jobId}:`, e);
  }
}
