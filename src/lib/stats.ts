import { redis } from "./redis";
import { deriveOutcome } from "./outcome";
import type { CallRecord } from "./models";

/**
 * Rolled-up report counters.
 *
 * Why this exists: we place up to ~20k calls/day. Computing report KPIs by
 * fetching every CallRecord and counting in JS does not scale — it caps out
 * (the old route silently stopped at 1000 records) and hammers Redis. Instead we
 * maintain small per-day counter hashes, incremented as each call progresses, and
 * the Reports route reads at most one hash per day in the range. Cost is O(days),
 * independent of call volume.
 *
 * Buckets are keyed by the call's PLACEMENT day in IST (Asia/Kolkata), so a call's
 * answered / press-1 / finalized events all land in the same day as it was placed,
 * and an India ops team's "today" matches the wall clock — not UTC midnight.
 *
 * Two hashes per day:
 *   stats:d:<day>            — all campaigns combined (also holds per-campaign tallies)
 *   stats:dc:<day>:<cid>     — a single campaign
 * Both share the same scalar/outcome/hour field schema so the reader can pick
 * either depending on whether a campaign filter is active.
 */

const TTL_SECONDS = 550 * 24 * 60 * 60; // keep ~18 months of history

const dayKey = (day: string) => `stats:d:${day}`;
const dcKey = (day: string, cid: string) => `stats:dc:${day}:${cid}`;

const OUTCOMES = ["press1", "connected", "busy", "no-answer", "rejected", "error"] as const;
type Outcome = (typeof OUTCOMES)[number];

// --- IST (UTC+5:30) wall-clock helpers ---------------------------------------
const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;
function istShifted(iso: string): string {
  return new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString();
}
export function istDay(iso: string): string {
  return istShifted(iso).slice(0, 10); // YYYY-MM-DD
}
export function istHour(iso: string): string {
  return istShifted(iso).slice(11, 13); // HH
}

// --- write path --------------------------------------------------------------
//
// PERFORMANCE (BUG 3): these increments are issued as standalone, autocommit
// statements — NOT wrapped in one transaction. During a bulk campaign every
// call hits the same hot counter rows on stats:d:<today> (total / h_<hour> /
// c_<cid>). A single transaction held each of those row locks from its first
// increment until COMMIT, so all 20k calls serialized on those rows and
// throughput collapsed to a trickle. Independent increments release each row
// lock immediately. Counters are monotonic and the reports backfill recomputes
// absolute totals from call records, so losing all-or-nothing atomicity here is
// harmless (and the previous TTL was already a no-op in the Postgres shim).

/** Call was placed (Plivo accepted it, or the place-call failed outright). */
export async function recordPlaced(c: CallRecord): Promise<void> {
  const day = istDay(c.triggeredAt);
  const hour = istHour(c.triggeredAt);
  const cid = c.campaignId || "none";
  const r = redis();
  for (const key of [dayKey(day), dcKey(day, cid)]) {
    await r.hincrby(key, "total", 1);
    await r.hincrby(key, `h_${hour}`, 1);
    if (c.status === "failed") {
      // A failed place-call never rings, so it's terminal here: count it as an error.
      await r.hincrby(key, "failed", 1);
      await r.hincrby(key, "o_error", 1);
    }
  }
  // Per-campaign breakdown for the "all campaigns" view lives on the global hash.
  await r.hincrby(dayKey(day), `c_${cid}`, 1);
}

/** Call was answered (first transition only — caller guards on prior answeredAt). */
export async function recordAnswered(c: CallRecord): Promise<void> {
  const day = istDay(c.triggeredAt);
  const cid = c.campaignId || "none";
  const r = redis();
  await r.hincrby(dayKey(day), "answered", 1);
  await r.hincrby(dcKey(day, cid), "answered", 1);
}

/** Caller pressed 1 (first transition only — caller guards on prior press1 status). */
export async function recordPress1(c: CallRecord): Promise<void> {
  const day = istDay(c.triggeredAt);
  const cid = c.campaignId || "none";
  const r = redis();
  await r.hincrby(dayKey(day), "press1", 1);
  await r.hincrby(dcKey(day, cid), "press1", 1);
}

/** Call finalized at hangup (first finalize only — caller guards on prior hangupAt). */
export async function recordFinalized(c: CallRecord, hangupCause: string, durationSec: number): Promise<void> {
  const outcome = deriveOutcome(hangupCause, c.digit, !!c.answeredAt) as Outcome;
  const day = istDay(c.triggeredAt);
  const cid = c.campaignId || "none";
  const r = redis();
  for (const key of [dayKey(day), dcKey(day, cid)]) {
    await r.hincrby(key, `o_${outcome}`, 1);
    if (durationSec > 0) await r.hincrby(key, "durSum", durationSec);
  }
}

// --- read path ---------------------------------------------------------------

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Inclusive list of IST day strings from `fromDay` to `toDay`. */
export function daysInRange(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${fromDay}T00:00:00.000Z`);
  const end = Date.parse(`${toDay}T00:00:00.000Z`);
  if (Number.isNaN(t) || Number.isNaN(end) || t > end) return out;
  // Hard cap so a fat-fingered range can't fan out into thousands of reads.
  for (let i = 0; i < 800 && t <= end; i++) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 24 * 60 * 60 * 1000;
  }
  return out;
}

export interface RangeAggregate {
  total: number;
  answered: number;
  press1: number;
  failed: number;
  durSum: number;
  outcomes: { press1: number; connected: number; busy: number; noAnswer: number; rejected: number; error: number; pending: number };
  byHour: Record<string, number>;      // key "YYYY-MM-DDTHH" (IST)
  byCampaignId: Record<string, number>; // campaignId -> count ("none" for unset)
}

/**
 * Aggregate counters across a day range. Reads one hash per day (per campaign if
 * filtered). `campaignId` null/undefined → all campaigns.
 */
export async function readRange(fromDay: string, toDay: string, campaignId?: string): Promise<RangeAggregate> {
  const days = daysInRange(fromDay, toDay);
  const r = redis();
  const hashes = await Promise.all(
    days.map((day) =>
      r.hgetall<Record<string, string | number>>(campaignId ? dcKey(day, campaignId) : dayKey(day))
    )
  );

  const agg: RangeAggregate = {
    total: 0, answered: 0, press1: 0, failed: 0, durSum: 0,
    outcomes: { press1: 0, connected: 0, busy: 0, noAnswer: 0, rejected: 0, error: 0, pending: 0 },
    byHour: {},
    byCampaignId: {},
  };
  const outcomeField: Record<Outcome, keyof RangeAggregate["outcomes"]> = {
    press1: "press1", connected: "connected", busy: "busy",
    "no-answer": "noAnswer", rejected: "rejected", error: "error",
  };

  days.forEach((day, i) => {
    const h = hashes[i];
    if (!h) return;
    agg.total += n(h.total);
    agg.answered += n(h.answered);
    agg.press1 += n(h.press1);
    agg.failed += n(h.failed);
    agg.durSum += n(h.durSum);
    for (const o of OUTCOMES) agg.outcomes[outcomeField[o]] += n(h[`o_${o}`]);
    for (const [field, val] of Object.entries(h)) {
      if (field.startsWith("h_")) {
        agg.byHour[`${day}T${field.slice(2)}`] = n(val);
      } else if (field.startsWith("c_")) {
        const cid = field.slice(2);
        agg.byCampaignId[cid] = (agg.byCampaignId[cid] || 0) + n(val);
      }
    }
  });

  const finalized = agg.outcomes.press1 + agg.outcomes.connected + agg.outcomes.busy +
    agg.outcomes.noAnswer + agg.outcomes.rejected + agg.outcomes.error;
  agg.outcomes.pending = Math.max(0, agg.total - finalized);
  return agg;
}

// --- backfill / resync -------------------------------------------------------

/**
 * Fold a single historical record into in-memory day maps. Mirrors the write-path
 * increments above so a full scan reproduces the same counters. Used by the
 * backfill route to rebuild stats from existing CallRecords.
 */
export function foldRecord(
  c: CallRecord,
  global: Map<string, Record<string, number>>,
  byCampaign: Map<string, Record<string, number>>
): void {
  const day = istDay(c.triggeredAt);
  const hour = istHour(c.triggeredAt);
  const cid = c.campaignId || "none";
  const g = bucket(global, day);
  const dc = bucket(byCampaign, `${day}|${cid}`);

  for (const b of [g, dc]) {
    b.total = (b.total || 0) + 1;
    b[`h_${hour}`] = (b[`h_${hour}`] || 0) + 1;
  }
  g[`c_${cid}`] = (g[`c_${cid}`] || 0) + 1;

  if (c.status === "failed") {
    for (const b of [g, dc]) {
      b.failed = (b.failed || 0) + 1;
      b["o_error"] = (b["o_error"] || 0) + 1;
    }
  }
  if (c.answeredAt) for (const b of [g, dc]) b.answered = (b.answered || 0) + 1;
  if (c.digit === "1") for (const b of [g, dc]) b.press1 = (b.press1 || 0) + 1;

  // Finalized (hangup happened, or place-call failed which we already scored above).
  if (c.hangupAt && c.status !== "failed") {
    const outcome = deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt);
    for (const b of [g, dc]) {
      b[`o_${outcome}`] = (b[`o_${outcome}`] || 0) + 1;
      if (c.durationSec && c.durationSec > 0) b.durSum = (b.durSum || 0) + c.durationSec;
    }
  }
}

function bucket(m: Map<string, Record<string, number>>, key: string): Record<string, number> {
  let b = m.get(key);
  if (!b) { b = {}; m.set(key, b); }
  return b;
}

/** Write computed buckets to Redis with HSET (absolute values — idempotent resync). */
export async function writeBackfill(
  global: Map<string, Record<string, number>>,
  byCampaign: Map<string, Record<string, number>>
): Promise<number> {
  const r = redis();
  let written = 0;
  for (const [day, fields] of global) {
    if (Object.keys(fields).length) {
      await r.del(dayKey(day));
      await r.hset(dayKey(day), fields);
      await r.expire(dayKey(day), TTL_SECONDS);
      written++;
    }
  }
  for (const [dayCid, fields] of byCampaign) {
    const [day, cid] = dayCid.split("|");
    if (Object.keys(fields).length) {
      await r.del(dcKey(day, cid));
      await r.hset(dcKey(day, cid), fields);
      await r.expire(dcKey(day, cid), TTL_SECONDS);
      written++;
    }
  }
  return written;
}
