import { redis, newId } from "./redis";
import type { BulkJob, BulkKind, BulkRow, BulkRowStatus } from "./models";

const KEY = (id: string) => `bulk:${id}`;
const ZINDEX = "bulk:zindex";
// Set of call-job ids the backend worker should keep draining. A job is in this
// set while it has pending rows and isn't paused. It's only a hint — the worker
// re-checks each job's real state and prunes finished/paused jobs itself.
const ACTIVE = "bulk:active";

export async function createBulkJob(input: {
  kind?: BulkKind;
  campaignId?: string;
  webhookUrl?: string;
  rows: { phone: string; name?: string; email?: string }[];
  delayMs?: number;
  jitterPct?: number;
  concurrency?: number;
}): Promise<BulkJob> {
  const kind = input.kind ?? "call";
  const j: BulkJob = {
    id: newId("blk"),
    kind,
    campaignId: input.campaignId ?? "",
    webhookUrl: input.webhookUrl || undefined,
    delayMs: input.delayMs ?? 2000,
    jitterPct: input.jitterPct,
    concurrency: input.concurrency,
    paused: false,
    rows: input.rows.map((r) => ({
      phone: r.phone,
      name: r.name,
      email: r.email,
      status: "pending" as BulkRowStatus,
    })),
    createdAt: new Date().toISOString(),
  };
  const r = redis();
  await r.set(KEY(j.id), j);
  await r.zadd(ZINDEX, { score: Date.parse(j.createdAt), member: j.id });
  // Only call-jobs are driven by the backend worker; WhatsApp bulk is paced elsewhere.
  if (kind === "call") await r.sadd(ACTIVE, j.id);
  return j;
}

// ---------------------------------------------------------------------------
// Active-set helpers — used by the backend worker to find jobs to drain without
// scanning every job blob on every tick.
// ---------------------------------------------------------------------------
export async function markActive(id: string): Promise<void> {
  await redis().sadd(ACTIVE, id);
}
export async function markInactive(id: string): Promise<void> {
  await redis().srem(ACTIVE, id);
}
export async function listActiveJobIds(): Promise<string[]> {
  return redis().smembers(ACTIVE);
}

/**
 * Pause or un-pause a job. Pausing leaves pending rows queued (Stop button);
 * un-pausing re-registers the job so the worker resumes draining it.
 */
export async function setJobPaused(jobId: string, paused: boolean): Promise<BulkJob | null> {
  const job = await redis().withLock<BulkJob | null>(KEY(jobId), (j: any) => {
    if (!j) return { ret: null };
    j.paused = paused;
    return { next: j, ret: j as BulkJob };
  });
  if (!job) return null;
  if (paused) await markInactive(jobId);
  else await markActive(jobId);
  return job;
}

export async function getBulkJob(id: string): Promise<BulkJob | null> {
  return (await redis().get<BulkJob>(KEY(id))) ?? null;
}

export async function listBulkJobs(limit = 20): Promise<BulkJob[]> {
  const r = redis();
  const ids = (await r.zrange(ZINDEX, 0, limit - 1, { rev: true })) as string[];
  if (!ids.length) return [];
  const rows = await Promise.all(ids.map((id) => r.get<BulkJob>(KEY(id))));
  return rows.filter((x): x is BulkJob => !!x);
}

/**
 * Atomically merge `patch` into a single bulk row.
 *
 * This MUST be atomic: the browser driver (firing /api/call) and Plivo's async
 * /api/hangup callbacks write to the same job blob concurrently. A naive
 * get-modify-set loses writes. We run the read-modify-write under a row lock
 * (`SELECT ... FOR UPDATE` on the kv row) so it executes as one indivisible step.
 */
export async function updateBulkRow(
  jobId: string,
  index: number,
  patch: Partial<BulkRow>
): Promise<BulkJob | null> {
  if (index < 0) return getBulkJob(jobId);
  // Drop undefined keys so they don't clobber existing values.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;

  return redis().withLock<BulkJob | null>(KEY(jobId), (job: any) => {
    if (!job) return { ret: null };
    if (!Array.isArray(job.rows)) return { ret: job as BulkJob };
    const row = job.rows[index];
    if (!row || typeof row !== "object") return { ret: job as BulkJob };
    Object.assign(row, clean);
    const allDone = job.rows.every(
      (rw: any) => rw.status === "ok" || rw.status === "failed"
    );
    if (allDone && !job.completedAt) job.completedAt = new Date().toISOString();
    return { next: job, ret: job as BulkJob };
  });
}

export async function deleteBulkJob(id: string): Promise<void> {
  const r = redis();
  await r.del(KEY(id));
  await r.zrem(ZINDEX, id);
}

// ---------------------------------------------------------------------------
// Batch-claim: atomically mark up to `n` pending rows as "dialing" and return
// them so the caller can fire them in parallel without double-dialing.
// ---------------------------------------------------------------------------
export async function claimBulkRows(
  jobId: string,
  n: number,
): Promise<Array<{ index: number; phone: string; name?: string; email?: string }>> {
  const want = Math.max(1, Math.min(n, 100));
  return redis().withLock<Array<{ index: number; phone: string; name?: string; email?: string }>>(
    KEY(jobId),
    (job: any) => {
      if (!job || !Array.isArray(job.rows)) return { ret: [] };
      const claimed: Array<{ index: number; phone: string; name?: string; email?: string }> = [];
      for (let i = 0; i < job.rows.length && claimed.length < want; i++) {
        const row = job.rows[i];
        if (row && row.status === "pending") {
          row.status = "dialing";
          const entry: { index: number; phone: string; name?: string; email?: string } = {
            index: i,
            phone: row.phone,
          };
          if (row.name) entry.name = row.name;
          if (row.email) entry.email = row.email;
          claimed.push(entry);
        }
      }
      return claimed.length > 0 ? { next: job, ret: claimed } : { ret: claimed };
    },
  );
}

// ---------------------------------------------------------------------------
// Recovery: reset any rows stuck in "dialing" back to "pending" so a resumed
// job can re-claim and re-dial them. Called before resume/retry to prevent
// rows from being permanently lost when an advance batch crashes mid-flight.
// ---------------------------------------------------------------------------
export async function resetDialingRows(jobId: string): Promise<number> {
  return redis().withLock<number>(KEY(jobId), (job: any) => {
    if (!job || !Array.isArray(job.rows)) return { ret: 0 };
    let count = 0;
    for (const row of job.rows) {
      if (row && row.status === "dialing") {
        row.status = "pending";
        count++;
      }
    }
    return count > 0 ? { next: job, ret: count } : { ret: count };
  });
}
