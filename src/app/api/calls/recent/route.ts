import { NextRequest, NextResponse } from "next/server";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";

export const dynamic = "force-dynamic";

/**
 * The most recent calls for the current client, across every campaign.
 *
 * This exists because the Dial screen was showing a list it held in React
 * state, which emptied on every refresh — so it looked as though single calls
 * weren't being kept. They always were: /api/call → placeCampaignCall records
 * every one, which is why they show up in Call reports and in admin Callers.
 * The page simply never asked for them back.
 *
 * /api/reports/calls can't serve this — it requires a campaign filter, and Dial
 * wants "my last few calls" regardless of which campaign they went through.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "20")), 100);

  try {
    const calls = await listCalls({ limit });
    const rows = calls.map((c) => {
      const settled = c.hangupAt || c.status === "failed";
      return {
        callUuid: c.callUuid,
        to: c.to,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        // "in-progress" is a real state here, not a gap: a call placed seconds
        // ago has no hangup yet.
        outcome: settled ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt) : "in-progress",
        status: c.status,
        digit: c.digit || "",
        durationSec: c.durationSec ?? null,
        triggeredAt: c.triggeredAt,
        bulkJobId: c.bulkJobId ?? null,
      };
    });
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[calls/recent] failed:", e);
    return NextResponse.json({ error: "Could not load recent calls." }, { status: 503 });
  }
}
