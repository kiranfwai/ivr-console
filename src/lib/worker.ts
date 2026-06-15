import {
  getBulkJob,
  listActiveJobIds,
  markActive,
  markInactive,
  resetDialingRows,
} from "./bulk";
import { getCampaign } from "./campaigns";
import { publicBaseUrl } from "./plivo";
import { fireBatch } from "./bulk-runner";

/**
 * In-process bulk-call worker.
 *
 * Bulk calls used to be driven by the browser: the open tab ran a while-loop
 * hitting /advance, so closing the tab stopped the campaign. This worker moves
 * that loop into the long-lived `next start` server process. Submitting a job
 * just enqueues it (createBulkJob adds it to the `bulk:active` set); this ticker
 * drains every active job server-side and the UI only polls for progress.
 *
 * State lives entirely in Postgres, so the worker is crash-safe: on (re)start it
 * recovers any rows stuck in "dialing" and re-registers unfinished jobs, then
 * continues where it left off — surviving deploys and restarts.
 */

const TICK_MS = 300; // how often we look for batches to fire across all jobs
const ERROR_BACKOFF_MS = 5000; // pause a job briefly after an unexpected batch error

const inFlight = new Set<string>(); // jobs with a batch currently firing
const nextAt = new Map<string, number>(); // jobId -> earliest time its next batch may fire

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export async function startWorker(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await recover();
  } catch (e) {
    console.error("[worker] recovery failed:", e);
  }
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Don't keep the process alive solely for the ticker.
  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();
  console.log("[worker] started");
}

/**
 * On boot, recover only jobs already in the active set — i.e. jobs the new
 * system enqueued or the operator explicitly resumed. For each, reset rows left
 * "dialing" by the crash/restart back to "pending" so they get re-dialed, then
 * re-validate membership. We deliberately do NOT sweep historical jobs: a job
 * with stray pending rows from before this feature must be resumed explicitly
 * (Resume button) so a deploy never surprise-dials abandoned numbers.
 */
async function recover(): Promise<void> {
  const ids = await listActiveJobIds();
  for (const id of ids) {
    const reset = await resetDialingRows(id);
    const job = await getBulkJob(id);
    const hasPending = job?.rows.some((r) => r.status === "pending");
    if (job && (job.kind ?? "call") === "call" && !job.paused && hasPending) {
      await markActive(id);
    } else {
      await markInactive(id);
    }
    if (reset) console.log(`[worker] recovered ${reset} dialing rows for ${id}`);
  }
}

async function tick(): Promise<void> {
  let ids: string[];
  try {
    ids = await listActiveJobIds();
  } catch (e) {
    console.error("[worker] tick: listActiveJobIds failed:", e);
    return;
  }
  const now = Date.now();
  for (const id of ids) {
    if (inFlight.has(id)) continue;
    if ((nextAt.get(id) ?? 0) > now) continue;
    inFlight.add(id);
    // Fire jobs concurrently; each paces itself via nextAt.
    void runJobBatch(id).finally(() => inFlight.delete(id));
  }
}

async function runJobBatch(id: string): Promise<void> {
  try {
    const job = await getBulkJob(id);
    if (!job || (job.kind ?? "call") !== "call" || job.paused) {
      await markInactive(id);
      nextAt.delete(id);
      return;
    }
    if (!job.rows.some((r) => r.status === "pending")) {
      await markInactive(id);
      nextAt.delete(id);
      return;
    }
    const campaign = await getCampaign(job.campaignId);
    if (!campaign) {
      // Can't dial without a campaign — drop it from the active set and log loudly.
      console.error(`[worker] job ${id}: campaign ${job.campaignId} not found, removing from queue`);
      await markInactive(id);
      nextAt.delete(id);
      return;
    }

    const n = Math.min(Math.max(1, job.concurrency ?? 3), 100);
    const r = await fireBatch(id, campaign, n, publicBaseUrl());

    if (!r.claimed) {
      // Someone else drained the last rows between our check and the claim.
      await markInactive(id);
      nextAt.delete(id);
      return;
    }
    nextAt.set(id, Date.now() + (job.delayMs ?? 1000));
  } catch (e) {
    // Transient error (e.g. Plivo/DB hiccup): keep the job queued, back off briefly.
    console.error(`[worker] job ${id} batch error:`, e);
    nextAt.set(id, Date.now() + ERROR_BACKOFF_MS);
  }
}
