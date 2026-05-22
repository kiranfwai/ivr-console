import { NextRequest, NextResponse } from "next/server";
import { getCampaign, updateCampaign, deleteCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const c = await getCampaign(params.id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ campaign: c });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const c = await updateCampaign(params.id, body);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ campaign: c });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteCampaign(params.id);
  return NextResponse.json({ ok: true });
}
