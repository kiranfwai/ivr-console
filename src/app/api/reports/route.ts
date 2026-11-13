import { NextRequest, NextResponse } from "next/server";
import { listCampaigns } from "@/lib/campaigns";
import { deriveOutcome } from "@/lib/outcome";
import { readRange } from "@/lib/stats";
import { resolveConnNamesByCallUuids } from "@/lib/gsheets";
import {
  campaignsInRange,
  chargesByCallId,
  istToday,
  listCallsForCampaigns,
  readRangeForCampaigns,
  spentInRange,
} from "@/lib/report-export";
import { parseCampaignIds } from "@/lib/report-format";

export const dynamic = "force-dynamic";

/**
 * Call report data for a date range and zero (= all), one or many campaigns.
 * GET ?from=&to=&campaigns=id1,id2   (the older `campaign=<id>` and `day=` still work)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const fromDay = day || url.searchParams.get("from") || undefined;
  const toDay = day || url.searchParams.get("to") || fromDay;
  const campaignIds = parseCampaignIds(url.searchParams);

  // ----- aggregates: read rolled-up counters (O(days), not O(calls)) -----
  // Default to "today" (IST) if no range is supplied.
  const today = istToday();
  const rangeFrom = fromDay || today;
  const rangeTo = toDay || today;

  // Unfiltered counters drive the campaign picker (every campaign that ran in
  // the range); the filtered ones drive the KPIs.
  const allAgg = await readRange(rangeFrom, rangeTo);
  const { agg, perCampaign } = campaignIds.length
    ? await readRangeForCampaigns(rangeFrom, rangeTo, campaignIds)
    : { agg: allAgg, perCampaign: new Map() };

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

  // Per-campaign breakdown table. Read each active campaign's rolled-up
  // aggregate over the same range (O(days) each). Capped at 50 campaigns so a long
  // campaign list can't fan out into an unbounded number of reads.
  const activeCids = Object.entries(agg.byCampaignId)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([cid]) => cid);
  const campaignTable = (
    await Promise.all(
      activeCids.map(async (cid) => {
        const a = perCampaign.get(cid) ?? (await readRange(rangeFrom, rangeTo, cid));
        const lifted = a.outcomes.press1 + a.outcomes.connected;
        const busy = a.outcomes.busy;
        // Everything settled that isn't lifted or busy (no-answer + rejected +
        // carrier error + place-call failures), so columns sum to total.
        const failed = Math.max(0, a.total - lifted - busy);
        return {
          campaignId: cid,
          name: cid === "none" ? "(none)" : nameById.get(cid) || cid,
          total: a.total,
          answered: a.answered,
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
  const recentCalls = await listCallsForCampaigns({ limit: 50, day, from: fromDay, to: toDay, campaignIds });

  // Resolve which recent calls originated from a Sheet Auto-Dial lead so we can
  // show the sheet's display name in the call log.  Non-fatal: a failure here
  // must not break the entire reports endpoint.
  let sheetNameByUuid = new Map<string, string>();
  const uuids = recentCalls.map((c) => c.callUuid).filter(Boolean);
  try {
    sheetNameByUuid = await resolveConnNamesByCallUuids(uuids);
  } catch {
    // non-fatal — sheet name column will just be empty
  }
  // What each recent call cost the wallet, and the range total. Non-fatal too.
  let charges = new Map<string, number>();
  let spent: number | null = null;
  try {
    [charges, spent] = await Promise.all([
      chargesByCallId(uuids),
      spentInRange(rangeFrom, rangeTo, campaignIds),
    ]);
  } catch (e) {
    console.error("[reports] wallet lookup failed:", e);
  }

  const recent = recentCalls.map((c) => ({
    ...c,
    outcome:
      c.hangupAt || c.status === "failed"
        ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt)
        : null,
    gsheetConnName: sheetNameByUuid.get(c.callUuid) ?? null,
    cost: charges.has(c.callUuid) ? charges.get(c.callUuid)! : null,
  }));

  // ----- why calls ended: from this range's own latest calls -----
  const hangupCauseCounts: Record<string, number> = {};
  for (const c of recentCalls) {
    if (!c.hangupCause) continue;
    hangupCauseCounts[c.hangupCause] = (hangupCauseCounts[c.hangupCause] || 0) + 1;
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
      lifted,
      notLifted,
      liftRate: total ? Math.round((lifted / total) * 100) : 0,
      spent,
    },
    outcomes,
    byHour: agg.byHour,
    byCampaign,
    campaignTable,
    // Every campaign that had calls in the range (ignores the campaign filter),
    // for the campaign picker.
    campaignsInRange: await campaignsInRange(rangeFrom, rangeTo, allAgg),
    selectedCampaigns: campaignIds,
    range: { from: rangeFrom, to: rangeTo },
    hangupCauseCounts,
    recent,
  });
}
