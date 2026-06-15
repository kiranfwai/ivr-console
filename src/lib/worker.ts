import {
  claimBulkRows,
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
 * In-process bulk-call worker — a per-job concurrency pump.
 *
 * Campaigns are dialed entirely server-side: submitting a job just inserts rows
 * with status 'running'; this pump keeps up to `concurrency` calls in flight per
 * job by claiming pending rows (FOR UPDATE SKIP LOCKED) and firing each one
 * independently. Closing the browser has no effect. State lives in Postgres, so
 * the worker is crash-safe: on boot it migrates any legacy blob jobs, resets
 * rows stuck in 'dialing', and resumes 'running' jobs where they left off.
 *
 * Stop = set job status 'paused' (worker stops claiming next tick; in-flight
 * calls finish). Resume = status 'running'. Both are durable in the DB.
 */

const TICK_MS = 200;
// Hard ceiling on parallel calls per job regardless of the job's setting — the
// box is a 1 GiB t3.micro. Raise via env on a bigger instance.
const MAX_CONCURRENCY = Number(process.env.WORKER_MAX_CONCURRENCY) || 40;

const inFlight = new Map<string, number>();   // jobId -> calls currently in flight
const pumping = new Set<string>();            // jobId -> a pumpJob claim is in progress
const nextClaimAt = new Map<string, number>(); // jobId -> earliest next claim (delay pacing)
const G = globalThis as unknown as { __ivrWorkerStarted?: boolean };

export async function startWorker(): Promise<void> {
  if (G.__ivrWorkerStarted) return;
  G.__ivrWorkerStarted = true;
  try {
    const m = await migrateBulkJobsFromKv();
    if (m.migrated) console.log(`[worker] migrated ${m.migrated} legacy job(s), ${m.rows} rows`);
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
  console.log("[worker] started");
}

async function recover(): Promise<void> {
  for (const job of await listRunningJobs()) {
    const n = await resetDialingRows(job.id);
    if (n) console.log(`[worker] recovered ${n} dialing rows for ${job.id}`);
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
  const cur = inFlight.get(job.id) ?? 0;
  const cap = Math.min(Math.max(1, job.concurrency), MAX_CONCURRENCY);
  const budget = cap - cur;

  // Optional pacing between claims (delayMs=0 → run at full concurrency).
  if (job.delayMs && (nextClaimAt.get(job.id) ?? 0) > now) {
    await maybeComplete(job.id, cur);
    return;
  }
  if (budget <= 0) return;

  let claimed;
  try {
    claimed = await claimBulkRows(job.id, budget);
  } catch (e) {
    console.error(`[worker] claim failed for ${job.id}:`, e);
    return;
  }
  if (!claimed.length) {
    await maybeComplete(job.id, cur);
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

  inFlight.set(job.id, (inFlight.get(job.id) ?? 0) + claimed.length);
  if (job.delayMs) nextClaimAt.set(job.id, Date.now() + job.delayMs);
  const base = publicBaseUrl();

  for (const row of claimed) {
    void fireOne(job.id, row, campaign, base)
      .catch((e) => console.error(`[worker] fireOne error ${job.id}#${row.index}:`, e))
      .finally(() => {
        const n = (inFlight.get(job.id) ?? 1) - 1;
        if (n <= 0) inFlight.delete(job.id);
        else inFlight.set(job.id, n);
      });
  }
}

/** Mark a job completed once nothing is pending and nothing is in flight. */
async function maybeComplete(jobId: string, cur: number): Promise<void> {
  if (cur > 0) return;
  try {
    if ((await countPending(jobId)) === 0) {
      await setJobStatus(jobId, "completed");
      nextClaimAt.delete(jobId);
      console.log(`[worker] job ${jobId} completed`);
    }
  } catch (e) {
    console.error(`[worker] completion check failed for ${jobId}:`, e);
  }
}
