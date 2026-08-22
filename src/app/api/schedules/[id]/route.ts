import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getSchedule, setScheduleEnabled, deleteSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PATCH — pause or resume. Resuming recomputes the next run, never fires late. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  const s = await setScheduleEnabled(clientId, params.id, body.enabled);
  if (!s) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  return NextResponse.json({ schedule: s });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = await getSchedule(clientId, params.id);
  if (!s) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  return NextResponse.json({ schedule: s });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ok = await deleteSchedule(clientId, params.id);
  if (!ok) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
