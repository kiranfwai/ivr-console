import { redis, newId } from "./redis";
import type { BulkJob, BulkKind, BulkRow, BulkRowStatus } from "./models";

// ---------------------------------------------------------------------------
// Key schema (per-job):
//   bulk:{id}          → BulkJob JSON with initial rows (immutable after creation)
//   bulk:{id}:pending  → sorted set  { member: rowIndex, score: rowIndex }
//   bulk:{id}:dialing  → set         rowIndex strings currently in-flight
//   bulk:{id}:results  → hash        rowIndex → JSON row-result patch
//   bulk:{id}:counts   → hash        { total, pending, dialing, ok, failed, … }
//   bulk:zindex        → sorted set  jobId → score(createdAt ms)
//
// Pre-new-schema ("legacy") jobs have only bulk:{id} and bulk:zindex.
// All exported functions detect legacy format and fall back automatically.
// ---------------------------------------------------------------------------
const JOB_KEY     = (id: string) => `bulk:${id}`;
const PENDING_KEY = (id: string) => `bulk:${id}:pending`;
const DIALING_KEY = (id: string) => `bulk:${id}:dialing`;
const RESULTS_KEY = (id: string) => `bulk:${id}:results`;
const COUNTS_KEY  = (id: string) => `bulk:${id}:counts`;
const ZINDEX = "bulk:zindex";

// ---------------------------------------------------------------------------
// createBulkJob
// ---------------------------------------------------------------------------
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
  const n = j.rows.length;
  const p = r.pipeline();

  // Main blob — rows stored with status "pending"; this blob is immutable
  // after creation. Ground truth for statuses lives in :counts / :results.
  p.set(JOB_KEY(j.id), j);

  // Pending sorted set (score = index preserves FIFO dial order).
  // Batch into chunks of 500 so each pipeline command stays under Upstash's
  // per-command payload limit.
  const ZADD_BATCH = 500;
  for (let b = 0; b < n; b += ZADD_BATCH) {
    const entries: { score: number; member: string }[] = [];
    for (let i = b; i < Math.min(b + ZADD_BATCH, n); i++) {
      entries.push({ score: i, member: String(i) });
    }
    p.zadd(PENDING_KEY(j.id), ...entries);
  }

  // Running-counter hash — all lookups/displays use this instead of scanning rows.
  p.hset(COUNTS_KEY(j.id), {
    total: n,
    pending: n,
    dialing: 0,
    ok: 0,
    failed: 0,
    press1: 0,
    connected: 0,
    "no-answer": 0,
    busy: 0,
    rejected: 0,
    error: 0,
  });

  p.zadd(ZINDEX, { score: Date.parse(j.createdAt), member: j.id });

  await p.exec();
  return j;
}

// ---------------------------------------------------------------------------
// getBulkJob — full load; merges initial row list with per-row results.
// Only call when you need per-row detail (retry, failed-rows view).
// For counts-only, call getJobCounts() instead.
// ---------------------------------------------------------------------------
export async function getBulkJob(id: string): Promise<BulkJob | null> {
  const r = redis();
  const [job, isNewFormat] = await Promise.all([
    r.get<BulkJob>(JOB_KEY(id)),
    r.exists(COUNTS_KEY(id)),
  ]);
  if (!job) return null;
  if (!isNewFormat) return job; // legacy: statuses baked into blob

  // Overlay per-row results onto initial rows.
  const rawResults = await r.hgetall<Record<string, string>>(RESULTS_KEY(id));
  if (rawResults) {
    for (const [idxStr, val] of Object.entries(rawResults)) {
      const idx = parseInt(idxStr, 10);
      if (Number.isFinite(idx) && idx >= 0 && idx < job.rows.length) {
        try {
          const result = typeof val === "string" ? JSON.parse(val) : val;
          job.rows[idx] = { ...job.rows[idx], ...result };
        } catch {}
      }
    }
  }
  return job;
}

// ---------------------------------------------------------------------------
// getJobCounts — O(1) counter read; use this for the 2-second polling loop.
// ---------------------------------------------------------------------------
export async function getJobCounts(
  id: string,
): Promise<Record<string, number> | null> {
  const r = redis();
  const raw = await r.hgetall<Record<string, string | number>>(COUNTS_KEY(id));
  if (!raw) return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    counts[k] = typeof v === "number" ? v : parseInt(String(v), 10) || 0;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// listBulkJobs — returns jobs with counts pre-fetched for the list view
// so the UI never needs to iterate rows just to display ok/failed badges.
// ---------------------------------------------------------------------------
export async function listBulkJobs(
  limit = 20,
): Promise<Array<BulkJob & { _counts?: Record<string, number> }>> {
  const r = redis();
  const ids = (await r.zrange(ZINDEX, 0, limit - 1, { rev: true })) as string[];
  if (!ids.length) return [];

  const [jobs, allCounts] = await Promise.all([
    Promise.all(ids.map((id) => r.get<BulkJob>(JOB_KEY(id)))),
    Promise.all(
      ids.map((id) =>
        r.hgetall<Record<string, string | number>>(COUNTS_KEY(id)),
      ),
    ),
  ]);

  return jobs
    .map((job, i) => {
      if (!job) return null;
      const raw = allCounts[i];
      if (!raw) return job; // legacy job — rows have baked-in statuses
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        counts[k] = typeof v === "number" ? v : parseInt(String(v), 10) || 0;
      }
      return { ...job, _counts: counts };
    })
    .filter(
      (x): x is BulkJob & { _counts?: Record<string, number> } => x !== null,
    );
}

// ---------------------------------------------------------------------------
// updateBulkRow — write result into the results hash; keep counts in sync.
// No longer touches the main job blob, so it never reads 1.7 MB of JSON.
// ---------------------------------------------------------------------------
const UPDATE_RESULT_LUA = `
local idx       = ARGV[1]
local patch_raw = ARGV[2]
local now       = ARGV[3]

-- Read existing result entry (may be empty for the first update on this row).
local existing_raw = redis.call('HGET', KEYS[2], idx)
local row = {}
if existing_raw and existing_raw ~= false then
  local ok_d, decoded = pcall(cjson.decode, existing_raw)
  if ok_d then row = decoded end
end

local oldStatus = row.status or 'dialing'

local patch = cjson.decode(patch_raw)
for k, v in pairs(patch) do row[k] = v end
local newStatus = row.status

redis.call('HSET', KEYS[2], idx, cjson.encode(row))

-- Keep the running-counter hash in sync.
if oldStatus ~= newStatus then
  redis.call('HINCRBY', KEYS[3], oldStatus, -1)
  redis.call('HINCRBY', KEYS[3], newStatus,  1)
end

-- Once a terminal status arrives, evict from the dialing set.
local terminal = {ok=1,failed=1,press1=1,connected=1,["no-answer"]=1,busy=1,rejected=1,error=1}
if terminal[newStatus] then
  redis.call('SREM', KEYS[4], idx)

  -- Stamp completedAt on the job blob when everything is settled.
  local pend  = tonumber(redis.call('HGET', KEYS[3], 'pending') or '0')
  local dial  = tonumber(redis.call('HGET', KEYS[3], 'dialing') or '0')
  if pend == 0 and dial == 0 then
    local raw = redis.call('GET', KEYS[1])
    if raw then
      local ok2, job = pcall(cjson.decode, raw)
      if ok2 and not job.completedAt then
        job.completedAt = now
        redis.call('SET', KEYS[1], cjson.encode(job))
      end
    end
  end
end

return cjson.encode(row)
`;

export async function updateBulkRow(
  jobId: string,
  index: number,
  patch: Partial<BulkRow>,
): Promise<BulkJob | null> {
  if (index < 0) return getBulkJob(jobId);
  const r = redis();

  const isNewFormat = await r.exists(COUNTS_KEY(jobId));
  if (!isNewFormat) return _legacyUpdateBulkRow(jobId, index, patch);

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;

  await r.eval(
    UPDATE_RESULT_LUA,
    [JOB_KEY(jobId), RESULTS_KEY(jobId), COUNTS_KEY(jobId), DIALING_KEY(jobId)],
    [String(index), JSON.stringify(clean), new Date().toISOString()],
  );

  // Callers (advance route, hangup route) ignore the return value.
  return null;
}

// ---------------------------------------------------------------------------
// claimBulkRows — pop pending rows from the sorted set (O(log N + n));
// update dialing set + counts atomically. No full-blob scan anymore.
// ---------------------------------------------------------------------------
const CLAIM_LUA = `
local n = tonumber(ARGV[1])

-- Pop the next n rows from the pending sorted set (lowest score = earliest index).
local popped = redis.call('ZPOPMIN', KEYS[2], n)
if not popped or #popped == 0 then return '[]' end

-- popped is interleaved: [member, score, member, score, …]
local indices = {}
for i = 1, #popped, 2 do
  table.insert(indices, popped[i])
end

-- Add to dialing set.
redis.call('SADD', KEYS[3], unpack(indices))

-- Update counts.
local count = #indices
redis.call('HINCRBY', KEYS[4], 'pending', -count)
redis.call('HINCRBY', KEYS[4], 'dialing',  count)

-- Fetch phone/name/email from the main job blob.
local job_raw = redis.call('GET', KEYS[1])
if not job_raw then return '[]' end
local ok, job = pcall(cjson.decode, job_raw)
if not ok then return '[]' end

local claimed = {}
for _, idx_str in ipairs(indices) do
  local idx = tonumber(idx_str)
  local row = job.rows[idx + 1]  -- Lua is 1-indexed
  if row then
    local entry = { index = idx, phone = row.phone }
    if row.name  and row.name  ~= false and row.name  ~= cjson.null then entry.name  = row.name  end
    if row.email and row.email ~= false and row.email ~= cjson.null then entry.email = row.email end
    table.insert(claimed, entry)
  end
end
return cjson.encode(claimed)
`;

export async function claimBulkRows(
  jobId: string,
  n: number,
): Promise<Array<{ index: number; phone: string; name?: string; email?: string }>> {
  const r = redis();

  const isNewFormat = await r.exists(COUNTS_KEY(jobId));
  if (!isNewFormat) return _legacyClaimBulkRows(jobId, n);

  const result = await r.eval(
    CLAIM_LUA,
    [JOB_KEY(jobId), PENDING_KEY(jobId), DIALING_KEY(jobId), COUNTS_KEY(jobId)],
    [String(Math.max(1, Math.min(n, 100)))],
  );
  if (result == null) return [];
  const parsed = typeof result === "string" ? JSON.parse(result) : result;
  return Array.isArray(parsed) ? parsed : [];
}

// ---------------------------------------------------------------------------
// resetDialingRows — recover in-flight rows back to pending after a crash.
// Call before resuming a paused/crashed job.
// ---------------------------------------------------------------------------
const RESET_DIALING_LUA = `
local members = redis.call('SMEMBERS', KEYS[2])
if #members == 0 then return 0 end
local count = #members
for _, idx_str in ipairs(members) do
  redis.call('ZADD', KEYS[1], tonumber(idx_str), idx_str)
end
redis.call('DEL',  KEYS[2])
redis.call('HINCRBY', KEYS[3], 'dialing', -count)
redis.call('HINCRBY', KEYS[3], 'pending',  count)
return count
`;

export async function resetDialingRows(jobId: string): Promise<number> {
  const r = redis();

  const isNewFormat = await r.exists(COUNTS_KEY(jobId));
  if (!isNewFormat) return _legacyResetDialingRows(jobId);

  const result = await r.eval(
    RESET_DIALING_LUA,
    [PENDING_KEY(jobId), DIALING_KEY(jobId), COUNTS_KEY(jobId)],
    [],
  );
  return typeof result === "number" ? result : Number(result ?? 0);
}

// ---------------------------------------------------------------------------
// deleteBulkJob
// ---------------------------------------------------------------------------
export async function deleteBulkJob(id: string): Promise<void> {
  const r = redis();
  await Promise.all([
    r.del(JOB_KEY(id)),
    r.del(PENDING_KEY(id)),
    r.del(DIALING_KEY(id)),
    r.del(RESULTS_KEY(id)),
    r.del(COUNTS_KEY(id)),
    r.zrem(ZINDEX, id),
  ]);
}

// ===========================================================================
// Legacy fallbacks — identical to the original Lua scripts, used for jobs
// created before the new key schema was deployed. These jobs have no :counts
// key; detecting its absence triggers the fallback automatically.
// ===========================================================================

const _LEGACY_UPDATE_ROW_LUA = `
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

async function _legacyUpdateBulkRow(
  jobId: string,
  index: number,
  patch: Partial<BulkRow>,
): Promise<BulkJob | null> {
  const r = redis();
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
  const result = await r.eval(
    _LEGACY_UPDATE_ROW_LUA,
    [JOB_KEY(jobId)],
    [String(index), JSON.stringify(clean), new Date().toISOString()],
  );
  if (result == null) return null;
  return (typeof result === "string" ? JSON.parse(result) : result) as BulkJob;
}

const _LEGACY_CLAIM_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local job = cjson.decode(raw)
if type(job.rows) ~= 'table' then return '[]' end
local n = tonumber(ARGV[1])
local claimed = {}
local count = 0
for i, row in ipairs(job.rows) do
  if count >= n then break end
  if row.status == 'pending' then
    row.status = 'dialing'
    local entry = {index = i - 1, phone = row.phone}
    if row.name  and row.name  ~= false and row.name  ~= cjson.null then entry.name  = row.name  end
    if row.email and row.email ~= false and row.email ~= cjson.null then entry.email = row.email end
    table.insert(claimed, entry)
    count = count + 1
  end
end
if count > 0 then
  redis.call('SET', KEYS[1], cjson.encode(job))
end
return cjson.encode(claimed)
`;

async function _legacyClaimBulkRows(
  jobId: string,
  n: number,
): Promise<Array<{ index: number; phone: string; name?: string; email?: string }>> {
  const r = redis();
  const result = await r.eval(
    _LEGACY_CLAIM_LUA,
    [JOB_KEY(jobId)],
    [String(Math.max(1, Math.min(n, 100)))],
  );
  if (result == null) return [];
  const parsed = typeof result === "string" ? JSON.parse(result) : result;
  return Array.isArray(parsed) ? parsed : [];
}

const _LEGACY_RESET_DIALING_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local job = cjson.decode(raw)
if type(job.rows) ~= 'table' then return 0 end
local count = 0
for i, row in ipairs(job.rows) do
  if row.status == 'dialing' then
    row.status = 'pending'
    count = count + 1
  end
end
if count > 0 then
  redis.call('SET', KEYS[1], cjson.encode(job))
end
return count
`;

async function _legacyResetDialingRows(jobId: string): Promise<number> {
  const r = redis();
  const result = await r.eval(_LEGACY_RESET_DIALING_LUA, [JOB_KEY(jobId)], []);
  return typeof result === "number" ? result : Number(result ?? 0);
}
