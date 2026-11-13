/**
 * Server-side helpers for Call reports with a date range and ANY number of
 * campaigns (the old screens took one campaign at a time).
 *
 * Everything here stays tenant-scoped exactly like the rest of the data layer:
 * call records, zsets and stats hashes go through redis() (which prefixes keys
 * with the client in scope), and wallet charges are filtered by the client id
 * in scope.
 */
import { query } from "./db";
import { listCalls } from "./calls";
import { listCampaigns } from "./campaigns";
import { readRange, type RangeAggregate } from "./stats";
import { currentClientId, scopeKey } from "./tenant";
import { resolveConnNamesByCallUuids } from "./gsheets";
import type { CallRecord } from "./models";
import {
  CSV_COLUMNS,
  callOutcome,
  causeLabel,
  istDate,
  istTime,
  mmss,
  statusLabel,
} from "./report-format";

const IST_OFFSET = "+05:30";
function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000${IST_OFFSET}`);
}
function dayEndMs(day: string): number {
  return dayStartMs(day) + 24 * 60 * 60 * 1000 - 1;
}

/** Today's IST calendar day. */
export function istToday(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Calls in a range for zero (= all), one or many campaigns, newest first.
 * Many campaigns: each campaign's own index is read (newest first, up to
 * `limit`), then merged — so the result is the true newest `limit` calls.
 */
export async function listCallsForCampaigns(opts: {
  campaignIds: string[];
  from?: string;
  to?: string;
  day?: string;
  limit: number;
}): Promise<CallRecord[]> {
  const { campaignIds, from, to, day, limit } = opts;
  if (campaignIds.length <= 1) {
    return listCalls({ limit, day, from, to, campaignId: campaignIds[0] });
  }
  const lists = await Promise.all(
    campaignIds.map((campaignId) => listCalls({ limit, day, from, to, campaignId })),
  );
  const seen = new Set<string>();
  const merged: CallRecord[] = [];
  for (const list of lists) {
    for (const c of list) {
      if (seen.has(c.callUuid)) continue;
      seen.add(c.callUuid);
      merged.push(c);
    }
  }
  merged.sort((a, b) => (Date.parse(b.triggeredAt) || 0) - (Date.parse(a.triggeredAt) || 0));
  return merged.slice(0, limit);
}

function emptyAgg(): RangeAggregate {
  return {
    total: 0, answered: 0, press1: 0, failed: 0, durSum: 0,
    outcomes: { press1: 0, connected: 0, busy: 0, noAnswer: 0, rejected: 0, error: 0, pending: 0 },
    byHour: {},
    byCampaignId: {},
  };
}

/**
 * Rolled-up counters for the range: all campaigns, or the sum of the chosen
 * ones. Also returns each chosen campaign's own aggregate so callers don't read
 * the same hashes twice.
 */
export async function readRangeForCampaigns(
  from: string,
  to: string,
  campaignIds: string[],
): Promise<{ agg: RangeAggregate; perCampaign: Map<string, RangeAggregate> }> {
  const perCampaign = new Map<string, RangeAggregate>();
  if (!campaignIds.length) {
    return { agg: await readRange(from, to), perCampaign };
  }
  const aggs = await Promise.all(campaignIds.map((id) => readRange(from, to, id)));
  const sum = emptyAgg();
  aggs.forEach((a, i) => {
    perCampaign.set(campaignIds[i], a);
    sum.total += a.total;
    sum.answered += a.answered;
    sum.press1 += a.press1;
    sum.failed += a.failed;
    sum.durSum += a.durSum;
    for (const k of Object.keys(sum.outcomes) as (keyof RangeAggregate["outcomes"])[]) {
      sum.outcomes[k] += a.outcomes[k];
    }
    for (const [h, v] of Object.entries(a.byHour)) sum.byHour[h] = (sum.byHour[h] || 0) + v;
    // A single campaign's hash carries no per-campaign tallies; its total is it.
    if (a.total) sum.byCampaignId[campaignIds[i]] = (sum.byCampaignId[campaignIds[i]] || 0) + a.total;
  });
  return { agg: sum, perCampaign };
}

export interface RangeCampaign {
  id: string;
  name: string;
  calls: number;
}

/**
 * The campaigns that had calls in [from, to], with their call counts, most
 * calls first. Read from the per-day counters (O(days), not O(calls)). Calls
 * with no campaign are left out: they cannot be picked as a filter.
 */
export async function campaignsInRange(
  from: string,
  to: string,
  allAgg?: RangeAggregate,
): Promise<RangeCampaign[]> {
  const agg = allAgg ?? (await readRange(from, to));
  const campaigns = await listCampaigns().catch(() => []);
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  return Object.entries(agg.byCampaignId)
    .filter(([id, n]) => id !== "none" && n > 0)
    .map(([id, calls]) => ({ id, name: nameById.get(id) || id, calls }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

/**
 * What each call actually cost the wallet: the sum of its charge (and any
 * refund) posted with ref = call id. Calls with no ledger row are absent.
 * Empty when no client is in scope (admin-level data has no wallet).
 */
export async function chargesByCallId(callIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const clientId = currentClientId();
  if (!clientId || !callIds.length) return out;
  const CHUNK = 5000;
  for (let i = 0; i < callIds.length; i += CHUNK) {
    const { rows } = await query<{ ref: string; cost: number }>(
      `SELECT ref, SUM(-amount)::float8 AS cost
         FROM wallet_txn
        WHERE client_id = $1 AND type IN ('charge', 'refund') AND ref = ANY($2)
        GROUP BY ref`,
      [clientId, callIds.slice(i, i + CHUNK)],
    );
    for (const r of rows) out.set(r.ref, Number(r.cost) || 0);
  }
  return out;
}

/**
 * Total wallet spend on the calls placed in [from, to] for the chosen
 * campaigns (all when empty). One query: charges joined to the call index by
 * call id. Null when no client is in scope.
 */
export async function spentInRange(from: string, to: string, campaignIds: string[]): Promise<number | null> {
  const clientId = currentClientId();
  if (!clientId) return null;
  const min = dayStartMs(from);
  const max = dayEndMs(to);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  const keys = campaignIds.length
    ? campaignIds.map((id) => scopeKey(`calls:bycampaign:${id}`))
    : [scopeKey("calls:zall")];
  const { rows } = await query<{ spent: number }>(
    `SELECT COALESCE(SUM(-w.amount), 0)::float8 AS spent
       FROM wallet_txn w
       JOIN zset z ON z.member = w.ref AND z.k = ANY($2) AND z.score >= $3 AND z.score <= $4
      WHERE w.client_id = $1
        AND w.type IN ('charge', 'refund')
        AND w.created_at >= to_timestamp($3 / 1000.0)`,
    [clientId, keys, min, max],
  );
  return Math.round((Number(rows[0]?.spent) || 0) * 100) / 100;
}

/** Sheet name per call id (non-fatal: empty map on failure). */
export async function sheetNames(callIds: string[]): Promise<Map<string, string>> {
  try {
    return await resolveConnNamesByCallUuids(callIds);
  } catch {
    return new Map();
  }
}

/** Where a call came from, from what the record + sheet queue actually store. */
export function callSource(c: CallRecord, sheetName: string | undefined): string {
  if (sheetName) return `Sheet · ${sheetName}`;
  if (c.bulkJobId) return "Bulk";
  return "Dial / API";
}

/** Cost cell: the ledger amount; 0 for a settled call that never connected; blank if unknown. */
export function costCell(c: CallRecord, outcome: string, charges: Map<string, number>): string {
  const v = charges.get(c.callUuid);
  if (v != null) return v.toFixed(2);
  if (!currentClientId()) return "";
  // Only connected calls are billed (hangup route), so a settled call that
  // never connected cost nothing.
  if (outcome !== "pending" && outcome !== "press1" && outcome !== "connected") return "0.00";
  return "";
}

function csvEscape(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The full CSV text (no BOM) for these calls, one row per call. */
export async function buildCallsCsv(calls: CallRecord[]): Promise<string> {
  const ids = calls.map((c) => c.callUuid).filter(Boolean);
  const [charges, sheets] = await Promise.all([
    chargesByCallId(ids).catch((e) => {
      console.error("[reports/csv] charge lookup failed:", e);
      return new Map<string, number>();
    }),
    sheetNames(ids),
  ]);
  const lines = [CSV_COLUMNS.map(csvEscape).join(",")];
  for (const c of calls) {
    const outcome = callOutcome(c);
    const dur = c.durationSec;
    lines.push(
      [
        c.callUuid,
        istDate(c.triggeredAt),
        istTime(c.triggeredAt),
        c.campaignName,
        c.to,
        c.name ?? "",
        c.email ?? "",
        statusLabel(outcome),
        c.answeredAt ? "Yes" : "No",
        dur ?? "",
        dur != null ? mmss(dur) : "",
        c.digit ?? "",
        c.digit === "1" ? "Yes" : "No",
        c.whatsappSentAt ? "Yes" : "No",
        causeLabel(c.hangupCause),
        c.from,
        callSource(c, sheets.get(c.callUuid)),
        costCell(c, outcome, charges),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
