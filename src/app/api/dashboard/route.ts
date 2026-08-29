import { NextRequest, NextResponse } from "next/server";
import { readRange } from "@/lib/stats";
import { listCampaigns } from "@/lib/campaigns";
import { listBulkJobs } from "@/lib/bulk";
import { listGSheetConns } from "@/lib/gsheets";
import { listSchedules } from "@/lib/schedule";
import { getBalance } from "@/lib/wallet";
import { getConnectedCallRate } from "@/lib/pricing";
import { currentClientId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Everything the Dashboard needs, in one request.
 *
 * The page could assemble this from the six endpoints it already has, but that
 * would be six round-trips on the screen people land on. This fans the same
 * reads out in parallel and returns one payload.
 *
 * No new tables and no new counters: every number here comes from something the
 * app was already recording. `readRange()` is the same rolled-up counter read
 * that Call reports runs on — O(days), not O(calls) — so widening the range
 * doesn't get slower in proportion to volume.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** "YYYY-MM-DD" for an instant, in IST — the day boundary the counters use. */
function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDays(day: string, delta: number): string {
  return istDay(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS + delta * 86_400_000);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign") || undefined;

  const today = istDay(Date.now());
  const toDay = url.searchParams.get("to") || today;
  const fromDay = url.searchParams.get("from") || shiftDays(toDay, -29);

  // The immediately preceding window of the same length, for the "vs previous"
  // deltas. Same read, different dates — nothing extra is stored for this.
  const span = Math.max(1, daysBetween(fromDay, toDay));
  const prevTo = shiftDays(fromDay, -1);
  const prevFrom = shiftDays(prevTo, -(span - 1));

  const clientId = currentClientId();

  // One read per day rather than one read for the whole span. Same underlying
  // hash reads (readRange already fetches one hash per day), but it also gives
  // an honest per-day CONNECTED figure for the chart — `byHour` only carries
  // totals, so folding that would have meant plotting one real series and
  // inventing the other.
  const days: string[] = [];
  for (let d = fromDay; days.length < 400; d = shiftDays(d, 1)) {
    days.push(d);
    if (d === toDay) break;
  }

  const [perDay, prev, campaigns, jobs, conns, schedules, balance, rate] = await Promise.all([
    Promise.all(days.map((d) => readRange(d, d, campaignId))),
    readRange(prevFrom, prevTo, campaignId),
    listCampaigns().catch(() => []),
    listBulkJobs(20).catch(() => []),
    clientId ? listGSheetConns(clientId).catch(() => []) : Promise.resolve([]),
    clientId ? listSchedules(clientId).catch(() => []) : Promise.resolve([]),
    clientId ? getBalance(clientId).catch(() => 0) : Promise.resolve(0),
    clientId ? getConnectedCallRate(clientId).catch(() => 0) : Promise.resolve(0),
  ]);

  // Fold the per-day reads back into one aggregate for the range.
  const agg = perDay.reduce(
    (a, d) => {
      a.total += d.total;
      a.answered += d.answered;
      a.press1 += d.press1;
      a.failed += d.failed;
      a.durSum += d.durSum;
      for (const k of Object.keys(a.outcomes) as (keyof typeof a.outcomes)[]) {
        a.outcomes[k] += d.outcomes[k];
      }
      for (const [cid, n] of Object.entries(d.byCampaignId)) {
        a.byCampaignId[cid] = (a.byCampaignId[cid] || 0) + n;
      }
      return a;
    },
    {
      total: 0,
      answered: 0,
      press1: 0,
      failed: 0,
      durSum: 0,
      outcomes: { press1: 0, connected: 0, busy: 0, noAnswer: 0, rejected: 0, error: 0, pending: 0 },
      byCampaignId: {} as Record<string, number>,
    },
  );

  // ----- headline numbers -----
  const connected = agg.outcomes.press1 + agg.outcomes.connected;
  const prevConnected = prev.outcomes.press1 + prev.outcomes.connected;
  const spent = connected * rate;

  const kpis = {
    placed: agg.total,
    placedPrev: prev.total,
    connected,
    connectedPrev: prevConnected,
    connectRate: agg.total ? connected / agg.total : 0,
    connectRatePrev: prev.total ? prevConnected / prev.total : 0,
    avgTalkSec: agg.answered ? Math.round(agg.durSum / agg.answered) : 0,
    avgTalkSecPrev: prev.answered ? Math.round(prev.durSum / prev.answered) : 0,
    press1: agg.press1,
    press1Prev: prev.press1,
    // Press-1 is a share of CONNECTED calls, not of all calls — mixing it into
    // the outcome split would make the percentages stop adding up.
    press1Rate: connected ? agg.press1 / connected : 0,
    press1RatePrev: prevConnected ? prev.press1 / prevConnected : 0,
    spent,
    spentPrev: prevConnected * rate,
    costPerLead: agg.press1 ? spent / agg.press1 : 0,
    costPerLeadPrev: prev.press1 ? (prevConnected * rate) / prev.press1 : 0,
    rate,
    balance,
  };

  // ----- per-day series for the chart -----
  const series = days.map((day, i) => ({
    day,
    placed: perDay[i].total,
    connected: perDay[i].outcomes.press1 + perDay[i].outcomes.connected,
  }));

  // ----- what's running right now -----
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const running = jobs
    .filter((j) => j.status === "running" || j.status === "paused")
    .map((j) => {
      const done = Object.entries(j.counts || {})
        .filter(([k]) => k !== "pending" && k !== "dialing")
        .reduce((n, [, v]) => n + (v || 0), 0);
      return {
        id: j.id,
        kind: j.kind,
        label: nameById.get(j.campaignId) || (j.kind === "whatsapp" ? "WhatsApp bulk" : "Bulk call"),
        status: j.status,
        pausedReason: j.pausedReason ?? null,
        done,
        total: j.total,
      };
    });

  const activeSheets = conns.filter((c) => c.enabled).length;

  // ----- what needs a human -----
  // Deliberately only things THIS client can act on. The seller's own invoice
  // settings are an admin concern and are not surfaced here.
  const attention: { id: string; severity: "danger" | "warn" | "info"; title: string; detail: string }[] = [];

  for (const c of conns) {
    if (c.lastError) {
      attention.push({
        id: `sheet:${c.id}`,
        severity: "danger",
        title: `Sheet “${c.connName || c.tabName}” can’t be read`,
        detail: c.lastError,
      });
    }
  }
  for (const s of schedules) {
    if (s.lastError) {
      attention.push({
        id: `schedule:${s.id}`,
        severity: "danger",
        title: `Schedule “${s.name}” failed on its last run`,
        detail: s.lastError,
      });
    }
  }
  for (const j of jobs) {
    if (j.status === "paused") {
      attention.push({
        id: `job:${j.id}`,
        severity: j.pausedReason === "low_balance" ? "danger" : "warn",
        title: `${nameById.get(j.campaignId) || "A batch"} is paused`,
        detail:
          j.pausedReason === "low_balance"
            ? "Stopped automatically because the wallet ran low. It resumes on its own once you top up."
            : "Paused by you. It will not dial until you resume it.",
      });
    }
  }
  // Runway: how many more connected calls the wallet covers at the current rate.
  const callsLeft = rate > 0 ? Math.floor(balance / rate) : null;
  const perDayConnected = span > 0 ? connected / span : 0;
  const daysLeft = callsLeft !== null && perDayConnected > 0 ? callsLeft / perDayConnected : null;
  if (callsLeft !== null && daysLeft !== null && daysLeft < 7) {
    attention.push({
      id: "wallet",
      severity: daysLeft < 2 ? "danger" : "warn",
      title: `Wallet covers about ${callsLeft.toLocaleString()} more connected calls`,
      detail: `At your recent rate that is roughly ${Math.max(1, Math.round(daysLeft))} more day${
        Math.round(daysLeft) === 1 ? "" : "s"
      } of dialling.`,
    });
  }

  // ----- what fires next -----
  const upcoming = schedules
    .filter((s) => s.enabled && s.nextRunAt)
    .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      repeat: s.repeat,
      nextRunAt: s.nextRunAt,
      recipientCount: s.recipientCount,
    }));

  return NextResponse.json({
    range: { from: fromDay, to: toDay, days: span, prevFrom, prevTo },
    kpis,
    outcomes: agg.outcomes,
    series,
    running,
    activeSheets,
    attention,
    upcoming,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    runway: { callsLeft, daysLeft },
  });
}
