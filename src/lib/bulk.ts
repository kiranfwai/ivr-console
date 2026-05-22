import { redis, newId } from "./redis";
import type { BulkJob, BulkKind, BulkRow, BulkRowStatus } from "./models";

const KEY = (id: string) => `bulk:${id}`;
const ZINDEX = "bulk:zindex";

export async function createBulkJob(input: {
  kind?: BulkKind;
  campaignId?: string;
  webhookUrl?: string;
  rows: { phone: string; name?: string }[];
  delayMs?: number;
  jitterPct?: number;
}): Promise<BulkJob> {
  const j: BulkJob = {
    id: newId("blk"),
    kind: input.kind ?? "call",
    campaignId: input.campaignId ?? "",
    webhookUrl: input.webhookUrl || undefined,
    delayMs: input.delayMs ?? 2000,
    jitterPct: input.jitterPct,
    rows: input.rows.map((r) => ({
      phone: r.phone,
      name: r.name,
      status: "pending" as BulkRowStatus,
    })),
    createdAt: new Date().toISOString(),
  };
  const r = redis();
  await r.set(KEY(j.id), j);
  await r.zadd(ZINDEX, { score: Date.parse(j.createdAt), member: j.id });
  return j;
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

export async function updateBulkRow(
  jobId: string,
  index: number,
  patch: Partial<BulkRow>
): Promise<BulkJob | null> {
  const r = redis();
  const job = await r.get<BulkJob>(KEY(jobId));
  if (!job) return null;
  if (index < 0 || index >= job.rows.length) return job;
  job.rows[index] = { ...job.rows[index], ...patch };
  const allDone = job.rows.every((row) => row.status === "ok" || row.status === "failed");
  if (allDone && !job.completedAt) job.completedAt = new Date().toISOString();
  await r.set(KEY(jobId), job);
  return job;
}

export async function deleteBulkJob(id: string): Promise<void> {
  const r = redis();
  await r.del(KEY(id));
  await r.zrem(ZINDEX, id);
}
