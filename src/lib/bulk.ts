import { redis, newId } from "./redis";
import type { BulkJob, BulkKind, BulkRow, BulkRowStatus } from "./models";

const KEY = (id: string) => `bulk:${id}`;
const ZINDEX = "bulk:zindex";

export async function createBulkJob(input: {
  kind?: BulkKind;
  campaignId?: string;
  webhookUrl?: string;
  rows: { phone: string; name?: string; email?: string }[];
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
      email: r.email,
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

/**
 * Atomically merge `patch` into a single bulk row.
 *
 * This MUST be atomic: the browser driver (firing /api/call) and Plivo's async
 * /api/hangup callbacks write to the same job blob concurrently. A naive
 * get-modify-set loses writes — e.g. a row's place-call result ("ok" + callUuid)
 * gets clobbered by a sibling row's hangup outcome, leaving the row stuck at
 * "pending" so the driver re-dials it. We run the read-modify-write inside a Lua
 * script so Redis executes it as one indivisible step.
 */
const UPDATE_ROW_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local job = cjson.decode(raw)
if type(job.rows) ~= 'table' then return raw end
local i = tonumber(ARGV[1]) + 1
local row = job.rows[i]
if type(row) ~= 'table' then return raw end
local patch = cjson.decode(ARGV[2])
for k, v in pairs(patch) do row[k] = v end
local allDone = true
for _, rw in ipairs(job.rows) do
  if rw.status ~= 'ok' and rw.status ~= 'failed' then allDone = false break end
end
if allDone and (job.completedAt == nil or job.completedAt == false) then
  job.completedAt = ARGV[3]
end
local encoded = cjson.encode(job)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

export async function updateBulkRow(
  jobId: string,
  index: number,
  patch: Partial<BulkRow>
): Promise<BulkJob | null> {
  if (index < 0) return getBulkJob(jobId);
  const r = redis();
  // Drop undefined keys — JSON.stringify omits them, and cjson would otherwise choke.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  const result = await r.eval(
    UPDATE_ROW_LUA,
    [KEY(jobId)],
    [String(index), JSON.stringify(clean), new Date().toISOString()]
  );
  if (result == null) return null;
  // Upstash may return the script's JSON string as-is or auto-deserialize it.
  return (typeof result === "string" ? JSON.parse(result) : result) as BulkJob;
}

export async function deleteBulkJob(id: string): Promise<void> {
  const r = redis();
  await r.del(KEY(id));
  await r.zrem(ZINDEX, id);
}
