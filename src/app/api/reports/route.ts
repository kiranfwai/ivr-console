import { NextRequest, NextResponse } from "next/server";
import { listCalls, countCalls } from "@/lib/calls";
import { listCampaigns } from "@/lib/campaigns";
import { listRecentCalls } from "@/lib/plivo";
import { deriveOutcome } from "@/lib/outcome";
import { readRange } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const fromDay = day || url.searchParams.get("from") || undefined;
  const toDay = day || url.searchParams.get("to") || fromDay;
  const campaignId = url.searchParams.get("campaign") || undefined;
  const wantPages = Math.max(1, Math.min(10, Number(url.searchParams.get("pages") || "2")));

  // ----- aggregates: read rolled-up counters (O(days), not O(calls)) -----
  // Default to "today" (IST) if no range is supplied.
  const today = new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
  const agg = await readRange(fromDay || today, toDay || today, campaignId);

  const total = agg.total;
  const answered = agg.answered;
  const press1 = agg.press1;
  const failed = agg.failed;
  const avgDuration = answered ? Math.round(agg.durSum / answered) : 0;

  const outcomes = agg.outcomes;
  const lifted = outcomes.press1 + outcomes.connected;
  const notLifted = outcomes.busy + outcomes.noAnswer;

  // Map campaign ids -> names for the "by campaign" chart.
  const campaigns = await listCampaigns().catch(() => []);
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const byCampaign: Record<string, number> = {};
  for (const [cid, count] of Object.entries(agg.byCampaignId)) {
    const label = cid === "none" ? "(none)" : nameById.get(cid) || cid;
    byCampaign[label] = (byCampaign[label] || 0) + count;
  }

  // Per-campaign breakdown table (FEATURE 3). Read each active campaign's rolled-up
  // aggregate over the same range (O(days) each). Capped at 50 campaigns so a long
  // campaign list can't fan out into an unbounded number of reads.
  const rangeFrom = fromDay || today;
  const rangeTo = toDay || today;
  const activeCids = Object.entries(agg.byCampaignId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([cid]) => cid);
  const campaignTable = (
    await Promise.all(
      activeCids.map(async (cid) => {
        const a = await readRange(rangeFrom, rangeTo, cid);
        const lifted = a.outcomes.press1 + a.outcomes.connected;
        const busy = a.outcomes.busy;
        // Everything settled that isn't lifted or busy (no-answer + rejected +
        // carrier error + place-call failures), so columns sum to total.
        const failed = Math.max(0, a.total - lifted - busy);
        return {
          campaignId: cid,
          name: cid === "none" ? "(none)" : nameById.get(cid) || cid,
          total: a.total,
          lifted,
          press1: a.press1,
          busy,
          failed,
          liftRate: a.total ? Math.round((lifted / a.total) * 100) : 0,
        };
      }),
    )
  )
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  // ----- recent table: only the latest rows are needed, fetched directly -----
  const recentCalls = await listCalls({ limit: 50, day, from: fromDay, to: toDay, campaignId });
  const recent = recentCalls.map((c) => ({
    ...c,
    outcome:
      c.hangupAt || c.status === "failed"
        ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt)
        : null,
  }));

  // ----- hangup causes from Plivo's recent call history (separate source) -----
  let plivoCalls: any[] = [];
  for (let p = 0; p < wantPages; p++) {
    try {
      const r = await listRecentCalls(20, p * 20);
      const objs = (r as any).objects || [];
      plivoCalls = plivoCalls.concat(objs);
      if (objs.length < 20) break;
    } catch {
      break;
    }
  }
  const hangupCauseCounts: Record<string, number> = {};
  for (const c of plivoCalls) {
    const k = c.hangup_cause_name || "Unknown";
    hangupCauseCounts[k] = (hangupCauseCounts[k] || 0) + 1;
  }

  return NextResponse.json({
    totals: {
      total,
      answered,
      press1,
      failed,
      answerRate: total ? Math.round((answered / total) * 100) : 0,
      press1Rate: total ? Math.round((press1 / total) * 100) : 0,
      avgDurationSec: avgDuration,
      totalsHorizonHint: await countCalls(),
      lifted,
      notLifted,
      liftRate: total ? Math.round((lifted / total) * 100) : 0,
    },
    outcomes,
    byHour: agg.byHour,
    byCampaign,
    campaignTable,
    range: { from: rangeFrom, to: rangeTo },
    hangupCauseCounts,
    recent,
    plivoRecent: plivoCalls.slice(0, 15),
  });
}
