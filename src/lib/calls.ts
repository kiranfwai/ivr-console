import { redis } from "./redis";
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

function dayRangeMs(day: string): [number, number] {
  const start = Date.parse(`${day}T00:00:00.000Z`);
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
  const rows = await Promise.all(ids.map((id) => r.get<CallRecord>(KEY(id))));
  return rows.filter((x): x is CallRecord => !!x);
}

export async function countCalls(opts: { day?: string; campaignId?: string } = {}): Promise<number> {
  const r = redis();
  const zset = opts.day ? ZDAY(opts.day) : opts.campaignId ? ZCAMPAIGN(opts.campaignId) : ZALL;
  return (await r.zcard(zset)) ?? 0;
}
