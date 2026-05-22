import { NextRequest, NextResponse } from "next/server";
import { listCalls, countCalls } from "@/lib/calls";
import { listRecentCalls } from "@/lib/plivo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const campaignId = url.searchParams.get("campaign") || undefined;
  const wantPages = Math.max(1, Math.min(10, Number(url.searchParams.get("pages") || "2")));

  const ourCalls = await listCalls({ limit: 500, day, campaignId });

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

  const total = ourCalls.length;
  const answered = ourCalls.filter((c) => !!c.answeredAt).length;
  const press1 = ourCalls.filter((c) => c.digit === "1").length;
  const failed = ourCalls.filter((c) => c.status === "failed").length;
  const totalDuration = ourCalls.reduce((s, c) => s + (c.durationSec || 0), 0);
  const avgDuration = answered ? Math.round(totalDuration / answered) : 0;

  const byHour: Record<string, number> = {};
  for (const c of ourCalls) {
    const k = c.triggeredAt.slice(0, 13);
    byHour[k] = (byHour[k] || 0) + 1;
  }

  const byCampaign: Record<string, number> = {};
  for (const c of ourCalls) {
    const k = c.campaignName || "(none)";
    byCampaign[k] = (byCampaign[k] || 0) + 1;
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
    },
    byHour,
    byCampaign,
    hangupCauseCounts,
    recent: ourCalls.slice(0, 25),
    plivoRecent: plivoCalls.slice(0, 15),
  });
}
