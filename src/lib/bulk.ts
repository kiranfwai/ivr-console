import { newId } from "./redis";
import { query, withTx } from "./db";
import { RETRY_STATUSES } from "./outcome";
import type {
  BulkJob,
  BulkJobCounts,
  BulkJobStatus,
  BulkJobWithCounts,
  BulkKind,
  BulkRow,
  BulkRowStatus,
} from "./models";

/**
 * Bulk-campaign persistence on a per-row Postgres work-queue.
 *
 * Each job is one `bulk_job` row (metadata) and N `bulk_row` rows (recipients).
 * Claiming pending rows uses `FOR UPDATE SKIP LOCKED` so the worker drains at
 * high concurrency without a global lock, and every per-call / hangup update
 * touches a single indexed row instead of rewriting a multi-MB JSON blob. This
 * replaces the old single-blob design (`kv` key `bulk:<id>`), which serialized
 * everything on one row lock and capped throughput.
 */

// --- row mappers -------------------------------------------------------------

type JobDbRow = {
  id: string;
  kind: string;
  campaign_id: string | null;
  webhook_url: string | null;
  concurrency: number;
  delay_ms: number;
  jitter_pct: number | null;
  status: string;
  total: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

function mapJob(r: JobDbRow): BulkJob {
  return {
    id: r.id,
    kind: (r.kind as BulkKind) ?? "call",
    campaignId: r.campaign_id ?? "",
    webhookUrl: r.webhook_url ?? undefined,
    concurrency: r.concurrency,
    delayMs: r.delay_ms,
    jitterPct: r.jitter_pct ?? undefined,
    status: r.status as BulkJobStatus,
    total: r.total,
    createdAt: r.created_at.toISOString(),
    startedAt: r.started_at ? r.started_at.toISOString() : undefined,
    completedAt: r.completed_at ? r.completed_at.toISOString() : undefined,
  };
}

const JOB_COLS = `id, kind, campaign_id, webhook_url, concurrency, delay_ms, jitter_pct,
  status, total, created_at, started_at, completed_at`;

function mapRow(r: any): BulkRow {
  return {
    idx: r.idx,
    phone: r.phone,
    name: r.name ?? undefined,
    email: r.email ?? undefined,
    status: r.status as BulkRowStatus,
    callUuid: r.call_uuid ?? undefined,
    error: r.error ?? undefined,
    hangupCause: r.hangup_cause ?? undefined,
    durationSec: r.duration_sec ?? undefined,
    attemptedAt: r.attempted_at ? new Date(r.attempted_at).toISOString() : undefined,
  };
}

// --- create ------------------------------------------------------------------

const ROW_INSERT_CHUNK = 500;

async function insertRows(
  c: { query: (t: string, p?: any[]) => Promise<any> },
  jobId: string,
  rows: { phone: string; name?: string; email?: string }[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += ROW_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + ROW_INSERT_CHUNK);
    const values: string[] = [];
    const params: any[] = [];
    chunk.forEach((r, j) => {
      const base = j * 5;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`);
      params.push(jobId, i + j, String(r.phone || ""), r.name ?? null, r.email ?? null);
    });
    await c.query(
      `INSERT INTO bulk_row (job_id, idx, phone, name, email) VALUES ${values.join(",")}`,
      params,
    );
  }
}

export async function createBulkJob(input: {
  kind?: BulkKind;
  campaignId?: string;
  webhookUrl?: string;
  rows: { phone: string; name?: string; email?: string }[];
  delayMs?: number;
  jitterPct?: number;
  concurrency?: number;
}): Promise<BulkJob> {
  const id = newId("blk");
  const kind = input.kind ?? "call";
  const total = input.rows.length;
  return withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO bulk_job (id, kind, campaign_id, webhook_url, concurrency, delay_ms, jitter_pct, status, total, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running',$8, now())
       RETURNING ${JOB_COLS}`,
      [
        id,
        kind,
        input.campaignId ?? null,
        input.webhookUrl || null,
        Math.max(1, input.concurrency ?? 30),
        Math.max(0, input.delayMs ?? 0),
        input.jitterPct ?? null,
        total,
      ],
    );
    await insertRows(c, id, input.rows);
    return mapJob(rows[0]);
  });
}

// --- read --------------------------------------------------------------------

export async function getBulkJob(id: string): Promise<BulkJob | null> {
  const { rows } = await query<JobDbRow>(`SELECT ${JOB_COLS} FROM bulk_job WHERE id=$1`, [id]);
  return rows.length ? mapJob(rows[0]) : null;
}

export async function tallyJob(jobId: string): Promise<BulkJobCounts> {
  const { rows } = await query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM bulk_row WHERE job_id=$1 GROUP BY status`,
    [jobId],
  );
  const out: BulkJobCounts = {};
  for (const r of rows) out[r.status as BulkRowStatus] = r.n;
  return out;
}

export async function getJobWithCounts(id: string): Promise<BulkJobWithCounts | null> {
  const job = await getBulkJob(id);
  if (!job) return null;
  return { ...job, counts: await tallyJob(id) };
}

export async function listBulkJobs(limit = 20): Promise<BulkJobWithCounts[]> {
  const { rows } = await query<JobDbRow>(
    `SELECT ${JOB_COLS} FROM bulk_job ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  if (!rows.length) return [];
  const jobs = rows.map(mapJob);
  const ids = jobs.map((j) => j.id);
  const { rows: cnt } = await query<{ job_id: string; status: string; n: number }>(
    `SELECT job_id, status, count(*)::int AS n FROM bulk_row WHERE job_id = ANY($1) GROUP BY job_id, status`,
    [ids],
  );
  const byJob = new Map<string, BulkJobCounts>();
  for (const r of cnt) {
    const m = byJob.get(r.job_id) ?? {};
    m[r.status as BulkRowStatus] = r.n;
    byJob.set(r.job_id, m);
  }
  return jobs.map((j) => ({ ...j, counts: byJob.get(j.id) ?? {} }));
}

export interface GetRowsOpts {
  statuses?: string[];   // exact statuses to include
  retryableOnly?: boolean;
  limit?: number;
  offset?: number;
  order?: "idx" | "recent"; // recent = most-recently attempted first (live log)
}

export async function getRows(jobId: string, opts: GetRowsOpts = {}): Promise<BulkRow[]> {
  const params: any[] = [jobId];
  let where = `job_id=$1`;
  const statuses = opts.retryableOnly ? [...RETRY_STATUSES] : opts.statuses;
  if (statuses && statuses.length) {
    params.push(statuses);
    where += ` AND status = ANY($${params.length})`;
  }
  const order = opts.order === "recent" ? `attempted_at DESC NULLS LAST, idx DESC` : `idx ASC`;
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);
  params.push(limit);
  let sql = `SELECT idx, phone, name, email, status, call_uuid, error, hangup_cause, duration_sec, attempted_at
             FROM bulk_row WHERE ${where} ORDER BY ${order} LIMIT $${params.length}`;
  if (opts.offset) {
    params.push(opts.offset);
    sql += ` OFFSET $${params.length}`;
  }
  const { rows } = await query(sql, params);
  return rows.map(mapRow);
}

export async function firstPendingRow(
  jobId: string,
): Promise<{ index: number; phone: string; name?: string; email?: string } | null> {
  const { rows } = await query(
    `SELECT idx, phone, name, email FROM bulk_row WHERE job_id=$1 AND status='pending' ORDER BY idx LIMIT 1`,
    [jobId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { index: r.idx, phone: r.phone, name: r.name ?? undefined, email: r.email ?? undefined };
}

/** All rows eligible for retry (no-answer / busy / error / failed), for cloning. */
export async function getRetryableRows(jobId: string): Promise<{ phone: string; name?: string }[]> {
  const { rows } = await query(
    `SELECT phone, name FROM bulk_row WHERE job_id=$1 AND status = ANY($2) ORDER BY idx`,
    [jobId, [...RETRY_STATUSES]],
  );
  return rows.map((r: any) => ({ phone: r.phone, name: r.name ?? undefined }));
}

export async function countPending(jobId: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bulk_row WHERE job_id=$1 AND status='pending'`,
    [jobId],
  );
  return rows[0]?.n ?? 0;
}

// --- claim + update ----------------------------------------------------------

/**
 * Atomically claim up to `n` pending rows (mark them "dialing") and return them.
 * FOR UPDATE SKIP LOCKED means concurrent claimers never block or double-claim.
 */
export async function claimBulkRows(
  jobId: string,
  n: number,
): Promise<Array<{ index: number; phone: string; name?: string; email?: string }>> {
  const want = Math.max(1, Math.min(n, 500));
  const { rows } = await query(
    `WITH c AS (
       SELECT idx FROM bulk_row
       WHERE job_id=$1 AND status='pending'
       ORDER BY idx LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE bulk_row b SET status='dialing', attempted_at=now()
     FROM c WHERE b.job_id=$1 AND b.idx=c.idx
     RETURNING b.idx, b.phone, b.name, b.email`,
    [jobId, want],
  );
  return rows.map((r: any) => ({
    index: r.idx,
    phone: r.phone,
    name: r.name ?? undefined,
    email: r.email ?? undefined,
  }));
}

const ROW_PATCH_COLS: Record<string, string> = {
  status: "status",
  callUuid: "call_uuid",
  error: "error",
  hangupCause: "hangup_cause",
  durationSec: "duration_sec",
  attemptedAt: "attempted_at",
};

function buildPatch(patch: Partial<BulkRow>, startIdx: number): { sets: string[]; params: any[] } {
  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, col] of Object.entries(ROW_PATCH_COLS)) {
    const v = (patch as any)[k];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col}=$${startIdx + params.length}`);
    }
  }
  return { sets, params };
}

export async function updateBulkRow(
  jobId: string,
  index: number,
  patch: Partial<BulkRow>,
): Promise<void> {
  if (index < 0) return;
  const { sets, params } = buildPatch(patch, 2);
  if (!sets.length) return;
  await query(
    `UPDATE bulk_row SET ${sets.join(", ")} WHERE job_id=$1 AND idx=$${2 + params.length}`,
    [jobId, ...params, index],
  );
}

/** Update a row by its call UUID (used by the Plivo hangup callback — indexed). */
export async function updateBulkRowByCallUuid(
  callUuid: string,
  patch: Partial<BulkRow>,
): Promise<void> {
  const { sets, params } = buildPatch(patch, 1);
  if (!sets.length) return;
  await query(
    `UPDATE bulk_row SET ${sets.join(", ")} WHERE call_uuid=$${1 + params.length}`,
    [...params, callUuid],
  );
}

/** Reset rows stuck in "dialing" (crash/restart recovery) back to pending. */
export async function resetDialingRows(jobId: string): Promise<number> {
  const { rowCount } = await query(
    `UPDATE bulk_row SET status='pending' WHERE job_id=$1 AND status='dialing'`,
    [jobId],
  );
  return rowCount ?? 0;
}

// --- job status (stop / resume / complete) -----------------------------------

export async function setJobStatus(jobId: string, status: BulkJobStatus): Promise<BulkJob | null> {
  const completedAt = status === "completed" ? "now()" : "completed_at";
  const startedAt = status === "running" ? "COALESCE(started_at, now())" : "started_at";
  const { rows } = await query<JobDbRow>(
    `UPDATE bulk_job SET status=$2, completed_at=${completedAt}, started_at=${startedAt}
     WHERE id=$1 RETURNING ${JOB_COLS}`,
    [jobId, status],
  );
  return rows.length ? mapJob(rows[0]) : null;
}

export async function listRunningJobs(): Promise<BulkJob[]> {
  const { rows } = await query<JobDbRow>(
    `SELECT ${JOB_COLS} FROM bulk_job WHERE status='running' ORDER BY created_at`,
  );
  return rows.map(mapJob);
}

export async function deleteBulkJob(id: string): Promise<void> {
  await withTx(async (c) => {
    await c.query(`DELETE FROM bulk_row WHERE job_id=$1`, [id]);
    await c.query(`DELETE FROM bulk_job WHERE id=$1`, [id]);
  });
}

// --- one-time migration from the old single-blob storage ---------------------

/**
 * Copy any legacy `kv` `bulk:<id>` job blobs into the new bulk_job/bulk_row
 * tables. Idempotent (skips jobs that already exist). Old blobs are left in
 * place as a backup. Runs once at worker boot so paused/in-flight jobs created
 * before this change are not lost.
 */
export async function migrateBulkJobsFromKv(): Promise<{ migrated: number; rows: number }> {
  const { rows: blobs } = await query<{ k: string; v: any }>(
    `SELECT k, v FROM kv WHERE k LIKE 'bulk:%'`,
  );
  let migrated = 0;
  let rowCount = 0;
  for (const b of blobs) {
    const id = b.k.slice("bulk:".length);
    if (!id) continue;
    const job = b.v;
    if (!job || !Array.isArray(job.rows)) continue;
    const exists = await query(`SELECT 1 FROM bulk_job WHERE id=$1`, [id]);
    if (exists.rows.length) continue;

    // Safety: never auto-start a migrated job. Anything still incomplete becomes
    // 'paused' so a deploy can't surprise-dial old numbers — the operator resumes
    // the specific job they want. Only fully-finished jobs migrate as 'completed'.
    const hasPending = job.rows.some((r: any) => r.status === "pending" || r.status === "dialing");
    const status: BulkJobStatus = hasPending ? "paused" : "completed";
    const createdAt = job.createdAt ? new Date(job.createdAt) : new Date();

    await withTx(async (c) => {
      await c.query(
        `INSERT INTO bulk_job (id, kind, campaign_id, webhook_url, concurrency, delay_ms, jitter_pct, status, total, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          job.kind ?? "call",
          job.campaignId ?? null,
          job.webhookUrl ?? null,
          Math.max(1, job.concurrency ?? 30),
          Math.max(0, job.delayMs ?? 0),
          job.jitterPct ?? null,
          status,
          job.rows.length,
          createdAt,
          job.completedAt ? new Date(job.completedAt) : null,
        ],
      );
      // Insert rows preserving their existing status / outcome fields.
      for (let i = 0; i < job.rows.length; i += ROW_INSERT_CHUNK) {
        const chunk = job.rows.slice(i, i + ROW_INSERT_CHUNK);
        const values: string[] = [];
        const params: any[] = [];
        chunk.forEach((r: any, j: number) => {
          const base = j * 10;
          values.push(
            `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`,
          );
          params.push(
            id,
            i + j,
            String(r.phone || ""),
            r.name ?? null,
            r.email ?? null,
            // rows stuck "dialing" at migration time are reset to pending so they re-dial
            r.status === "dialing" ? "pending" : r.status || "pending",
            r.callUuid ?? null,
            r.error ?? null,
            r.hangupCause ?? null,
            r.durationSec ?? null,
          );
        });
        await c.query(
          `INSERT INTO bulk_row (job_id, idx, phone, name, email, status, call_uuid, error, hangup_cause, duration_sec)
           VALUES ${values.join(",")}`,
          params,
        );
      }
    });
    migrated++;
    rowCount += job.rows.length;
  }
  return { migrated, rows: rowCount };
}
