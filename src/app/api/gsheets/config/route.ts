import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import {
  listGSheetConns,
  createGSheetConn,
  resolveTabSelection,
} from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — return all sheet connections for this client. */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const connections = await listGSheetConns(clientId);
  return NextResponse.json({ connections });
}

/** POST — create a new sheet connection (does NOT replace existing ones). */
export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawUrl: string = (body.sheetUrl ?? body.sheetId ?? "").trim();
  const campaignId: string = (body.campaignId ?? "").trim();

  if (!rawUrl) return NextResponse.json({ error: "sheetUrl is required" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });

  const tab = resolveTabSelection({
    sheetUrl: rawUrl,
    tabName: body.tabName,
    tabMode: body.tabMode,
    gid: body.gid,
  });
  if (!tab.ok) return NextResponse.json({ error: tab.error }, { status: 400 });

  const callStartHour = Number(body.callStartHour ?? 9);
  const callEndHour   = Number(body.callEndHour   ?? 21);
  if (
    callStartHour < 0 || callStartHour > 23 ||
    callEndHour   < 1 || callEndHour   > 24 ||
    callStartHour >= callEndHour
  ) {
    return NextResponse.json({ error: "Invalid calling window hours" }, { status: 400 });
  }

  const connection = await createGSheetConn(clientId, {
    sheetId:       tab.sheetId,
    tabName:       tab.tabName,
    gid:           tab.gid,
    campaignId,
    callStartHour,
    callEndHour,
    connName:      (body.connName ?? "").trim() || null,
  });
  return NextResponse.json({ ok: true, connection });
}
