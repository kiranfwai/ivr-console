import { NextRequest, NextResponse } from "next/server";
import { getCampaign } from "@/lib/campaigns";
import { placeCampaignCall } from "@/lib/place-campaign-call";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { phone, campaignId, callerName, email, bulkJobId, bulkRowIndex } = body;

  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campaign = await getCampaign(campaignId);
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  // The actual dialing + answer-URL wiring + call recording lives in one shared
  // helper so the external trigger API (/api/trigger-call) fires calls identically.
  const result = await placeCampaignCall({ campaign, phone, callerName, email, bulkJobId, bulkRowIndex, req });
  return NextResponse.json(result);
}
