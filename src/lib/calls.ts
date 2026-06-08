import { redis } from "./redis";
import { recordPlaced, foldRecord, writeBackfill } from "./stats";
import type { CallRecord, CallStatus } from "./models";

const KEY = (uuid: string) => `call:${uuid}`;
const ZALL = "calls:zall";
const ZDAY = (day: string) => `calls:byday:${day}`;
const ZCAMPAIGN = (id: string) => `calls:bycampaign:${id}`;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function recordCall(c: CallRecord): Promise<void> {
  const r = redis();
  const score = Date.parse(c.triggeredAt);
  await r.set(KEY(c.callUuid), c);
  await r.zadd(ZALL, { score, member: c.callUuid });
  await r.zadd(ZDAY(dayKey(c.triggeredAt)), { score, member: c.callUuid });
  if (c.campaignId) {
    await r.zadd(ZCAMPAIGN(c.campaignId), { score, member: c.callUuid });
  }
  await recordPlaced(c);
}

export async function getCall(uuid: string): Promise<CallRecord | null> {
  return (await redis().get<CallRecord>(KEY(uuid))) ?? null;
}

export async function patchCall(uuid: string, patch: Partial<CallRecord>): Promise<CallRecord | null> {
  const r = redis();
  const cur = await r.get<CallRecord>(KEY(uuid));
  if (!cur) return null;
  const next = { ...cur, ...patch } as CallRecord;
  await r.set(KEY(uuid), next);
  return next;
}

export async function updateCallStatus(uuid: string, status: CallStatus, extra: Partial<CallRecord> = {}): Promise<void> {
  await patchCall(uuid, { status, ...extra });
}

export interface ListOpts {
  limit?: number;
  offset?: number;
  day?: string;          // single day yyyy-mm-dd
  from?: string;         // range start yyyy-mm-dd inclusive
  to?: string;           // range end yyyy-mm-dd inclusive
  campaignId?: string;
}

// Day strings ("YYYY-MM-DD") are interpreted as Asia/Kolkata (IST, +05:30)
// calendar days, since this is an India-based ops team. A call placed at 11pm IST
// must land in that day's bucket, not roll over to the next UTC day.
const IST_OFFSET = "+05:30";
function dayRangeMs(day: string): [number, number] {
  const start = Date.parse(`${day}T00:00:00.000${IST_OFFSET}`);
  return [start, start + 24 * 60 * 60 * 1000 - 1];
}

export async function listCalls(opts: ListOpts = {}): Promise<CallRecord[]> {
  const r = redis();
  const limit = opts.limit ?? 500;

  // Pick source zset (per-campaign or all)
  const zset = opts.campaignId ? ZCAMPAIGN(opts.campaignId) : ZALL;

  let ids: string[];
  if (opts.from || opts.to || opts.day) {
    const fromDay = opts.day || opts.from!;
    const toDay = opts.day || opts.to || opts.from!;
    const [minScore] = dayRangeMs(fromDay);
    const [, maxScore] = dayRangeMs(toDay);
    ids = (await r.zrange(zset, maxScore, minScore, {
      byScore: true,
      rev: true,
      offset: opts.offset ?? 0,
      count: limit,
    })) as string[];
  } else {
    ids = (await r.zrange(zset, opts.offset ?? 0, (opts.offset ?? 0) + limit - 1, { rev: true })) as string[];
  }

  if (!ids.length) return [];
  return getCallsByIds(ids);
}

/** Fetch many call records by id, batched with MGET (avoids one round-trip per id). */
export async function getCallsByIds(ids: string[]): Promise<CallRecord[]> {
  if (!ids.length) return [];
  const r = redis();
  const out: CallRecord[] = [];
  const CHUNK = 256;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const keys = ids.slice(i, i + CHUNK).map(KEY);
    const recs = (await r.mget(...keys)) as (CallRecord | null)[];
    for (const rec of recs) if (rec) out.push(rec);
  }
  return out;
}

export async function countCalls(opts: { day?: string; campaignId?: string } = {}): Promise<number> {
  const r = redis();
  const zset = opts.day ? ZDAY(opts.day) : opts.campaignId ? ZCAMPAIGN(opts.campaignId) : ZALL;
  return (await r.zcard(zset)) ?? 0;
}

/**
 * Rebuild the stats counters for an IST day range by scanning the call records in
 * that range and re-folding them. Streams through Redis in pages so memory stays
 * flat regardless of volume (only the small counter maps are held). Idempotent:
 * each touched day is overwritten with absolute totals, so it doubles as a resync.
 */
export async function backfillStats(fromDay: string, toDay: string): Promise<{ scanned: number; daysWritten: number }> {
  const r = redis();
  const start = Date.parse(`${fromDay}T00:00:00.000+05:30`);
  const end = Date.parse(`${toDay}T00:00:00.000+05:30`) + 24 * 60 * 60 * 1000 - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return { scanned: 0, daysWritten: 0 };
  }

  const global = new Map<string, Record<string, number>>();
  const byCampaign = new Map<string, Record<string, number>>();
  let scanned = 0;
  const page = 500;
  let offset = 0;
  for (;;) {
    const ids = (await r.zrange(ZALL, end, start, {
      byScore: true,
      rev: true,
      offset,
      count: page,
    })) as string[];
    if (!ids.length) break;
    const recs = (await r.mget(...ids.map(KEY))) as (CallRecord | null)[];
    for (const rec of recs) {
      if (rec) {
        foldRecord(rec, global, byCampaign);
        scanned++;
      }
    }
    if (ids.length < page) break;
    offset += page;
  }

  const daysWritten = await writeBackfill(global, byCampaign);
  return { scanned, daysWritten };
}
