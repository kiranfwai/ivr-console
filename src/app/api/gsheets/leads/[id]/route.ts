import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { deleteLead } from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** DELETE /api/gsheets/leads/[id] — remove a single lead. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await deleteLead(clientId, id);
  return NextResponse.json({ ok: true });
}
