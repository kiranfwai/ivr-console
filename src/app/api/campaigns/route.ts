import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, createCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (e) {
    console.error("[campaigns:GET]", e);
    return NextResponse.json({ error: "Could not load campaigns." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const c = await createCampaign({
      name: String(body.name),
      audioId: body.audioId ?? null,
      prompt: body.prompt,
      webhookUrl: body.webhookUrl,
      fromNumber: body.fromNumber,
    });
    return NextResponse.json({ campaign: c }, { status: 201 });
  } catch (e) {
    console.error("[campaigns:POST]", e);
    return NextResponse.json({ error: "Could not create campaign." }, { status: 500 });
  }
}
