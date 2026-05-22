import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, createCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ campaigns: await listCampaigns() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const c = await createCampaign({
    name: String(body.name),
    audioId: body.audioId ?? null,
    prompt: body.prompt,
    webhookUrl: body.webhookUrl,
    fromNumber: body.fromNumber,
  });
  return NextResponse.json({ campaign: c });
}
