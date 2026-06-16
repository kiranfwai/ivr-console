import { NextRequest, NextResponse } from "next/server";
import { getCampaign, updateCampaign, deleteCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const c = await getCampaign(params.id);
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ campaign: c });
  } catch (e) {
    console.error("[campaigns/[id]:GET]", e);
    return NextResponse.json({ error: "Could not load campaign." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const c = await updateCampaign(params.id, body);
    if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ campaign: c });
  } catch (e) {
    console.error("[campaigns/[id]:PATCH]", e);
    return NextResponse.json({ error: "Could not update campaign." }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteCampaign(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[campaigns/[id]:DELETE]", e);
    return NextResponse.json({ error: "Could not delete campaign." }, { status: 500 });
  }
}
