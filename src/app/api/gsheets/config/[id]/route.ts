import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import {
  getGSheetConn,
  updateGSheetConn,
  deleteGSheetConn,
  setGSheetConnEnabled,
  extractSheetId,
} from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PATCH /api/gsheets/config/[id] — toggle enabled or update config for one connection. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connId = params.id;
  const conn = await getGSheetConn(connId);
  if (!conn || conn.clientId !== clientId) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  // Toggle enabled/disabled
  if (typeof body.enabled === "boolean") {
    await setGSheetConnEnabled(clientId, connId, body.enabled);
    return NextResponse.json({ ok: true });
  }

  // Update connection config
  const rawUrl: string = (body.sheetUrl ?? body.sheetId ?? "").trim();
  const campaignId: string = (body.campaignId ?? "").trim();

  if (!rawUrl) return NextResponse.json({ error: "sheetUrl is required" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });

  const sheetId = extractSheetId(rawUrl);
  if (!sheetId) return NextResponse.json({ error: "Could not parse a sheet ID from that URL" }, { status: 400 });

  const callStartHour = Number(body.callStartHour ?? 9);
  const callEndHour   = Number(body.callEndHour   ?? 21);
  if (
    callStartHour < 0 || callStartHour > 23 ||
    callEndHour   < 1 || callEndHour   > 24 ||
    callStartHour >= callEndHour
  ) {
    return NextResponse.json({ error: "Invalid calling window hours" }, { status: 400 });
  }

  const updated = await updateGSheetConn(clientId, connId, {
    sheetId,
    tabName:       (body.tabName ?? "Sheet1").trim() || "Sheet1",
    campaignId,
    callStartHour,
    callEndHour,
    connName:      (body.connName ?? "").trim() || null,
  });
  return NextResponse.json({ ok: true, connection: updated });
}

/** DELETE /api/gsheets/config/[id] — disconnect one sheet connection and clear its leads. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connId = params.id;
  const conn = await getGSheetConn(connId);
  if (!conn || conn.clientId !== clientId) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  await deleteGSheetConn(clientId, connId);
  return NextResponse.json({ ok: true });
}
