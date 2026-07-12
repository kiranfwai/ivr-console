import {
  claimBulkRows,
  countDialing,
  countLive,
  countPending,
  listGatedJobs,
  listRunningJobs,
  migrateBulkJobsFromKv,
  requeueStaleDialingRows,
  resetDialingRows,
  setJobStatus,
} from "./bulk";
import { getCampaign } from "./campaigns";
import { publicBaseUrl } from "./plivo";
import { fireOne } from "./bulk-runner";
import { runWithTenant } from "./tenant";
import { canDial } from "./wallet";

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
const ungating = new Set<string>();           // jobId -> an auto-resume check is in progress
const nextGateCheckAt = new Map<string, number>(); // jobId -> earliest next balance re-check
// How often to re-check a balance-paused job's wallet before auto-resuming it.
// Tick runs every 200ms; this throttles the (cheap, indexed) canDial reads and
// stops a still-underfunded job from flapping every tick.
const GATE_RECHECK_MS = Number(process.env.WORKER_GATE_RECHECK_MS) || 5000;
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
    // Row ops are tenant-scoped — run inside the job's client so its rows match.
    await runWithTenant(job.clientId ?? "", () => resetDialingRows(job.id));
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
    // The entire pump for this job runs inside its client's tenant scope, so
    // every campaign read, live count, row claim, call record and stats write
    // lands in (and reads from) that client's partition.
    void runWithTenant(job.clientId ?? "", () => pumpJob(job, now)).finally(() =>
      pumping.delete(job.id),
    );
  }

  await autoResumeGatedJobs(now);
}

/**
 * Auto-resume pass: bring back jobs the worker paused for low balance once the
 * wallet can cover a call again (e.g. after a top-up), so a paused campaign
 * un-sticks itself without a manual Resume. User-initiated Stops (paused_reason
 * NULL) are not in this list, so they stay stopped. Each candidate is re-checked
 * at most every GATE_RECHECK_MS to avoid flapping a still-underfunded job.
 */
async function autoResumeGatedJobs(now: number): Promise<void> {
  let jobs;
  try {
    jobs = await listGatedJobs();
  } catch (e) {
    console.error("[worker] tick: listGatedJobs failed:", e);
    return;
  }
  for (const job of jobs) {
    if (job.kind !== "call") continue;
    if (ungating.has(job.id)) continue;
    if ((nextGateCheckAt.get(job.id) ?? 0) > now) continue;
    nextGateCheckAt.set(job.id, now + GATE_RECHECK_MS);
    ungating.add(job.id);
    void runWithTenant(job.clientId ?? "", () => tryUngate(job))
      .catch((e) => console.error(`[worker] auto-resume error ${job.id}:`, e))
      .finally(() => ungating.delete(job.id));
  }
}

async function tryUngate(job: { id: string; clientId?: string }): Promise<void> {
  const gate = await canDial(job.clientId ?? "");
  if (!gate.ok) return; // still can't afford a call — leave it gated
  // Recover any stale 'dialing' rows and flip back to running (clears
  // paused_reason). The next tick pumps it from the remaining pending rows.
  await resetDialingRows(job.id);
  await setJobStatus(job.id, "running");
  nextGateCheckAt.delete(job.id);
  console.info(`[worker] job ${job.id} auto-resumed — wallet balance recovered (₹${gate.balance})`);
}

async function pumpJob(
  job: { id: string; clientId?: string; campaignId: string; concurrency: number; delayMs: number },
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

  // Prepaid gate + wallet-affordability cap, checked BEFORE claiming so we never
  // place more connected calls than the balance can cover. Admin/legacy jobs
  // (no client) return ok with rate 0 and are never capped.
  const gate = await canDial(job.clientId ?? "");
  if (!gate.ok) {
    // Tag the pause as balance-gated so the tick's auto-resume pass can bring it
    // back once the wallet is topped up — no manual Resume needed.
    await setJobStatus(job.id, "paused", "low_balance");
    console.warn(
      `[worker] job ${job.id} paused — insufficient wallet balance (₹${gate.balance} < ₹${gate.rate}/call)`,
    );
    return;
  }
  // Never claim more than the wallet can afford: a small top-up on a large job
  // can't drive the balance deeply negative (charges land on hangup, and we
  // re-check the balance every tick as calls settle).
  const affordable = gate.rate > 0 ? Math.floor(gate.balance / gate.rate) : Infinity;

  const want = Math.min(headroom, CLAIM_BATCH, affordable);
  if (want <= 0) {
    await maybeComplete(job.id);
    return;
  }
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
 *
 * Before checking, sweep any rows wedged in 'dialing' past the live window back
 * to 'pending' (see requeueStaleDialingRows): those are orphans from a failed
 * fireOne write that would otherwise keep countDialing > 0 forever and stall the
 * job at ~99% "running". Re-queued rows re-dial next tick and then finalize.
 */
async function maybeComplete(jobId: string): Promise<void> {
  try {
    const requeued = await requeueStaleDialingRows(jobId, MAX_CALL_SEC);
    if (requeued > 0) {
      console.warn(`[worker] job ${jobId}: re-queued ${requeued} stale 'dialing' row(s) to pending`);
      return; // let the next tick claim + finalize them before we consider completion
    }
    if ((await countPending(jobId)) === 0 && (await countDialing(jobId)) === 0) {
      await setJobStatus(jobId, "completed");
      nextClaimAt.delete(jobId);
    }
  } catch (e) {
    console.error(`[worker] completion check failed for ${jobId}:`, e);
  }
}
