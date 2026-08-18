import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import {
  getGSheetConfig,
  saveGSheetConfig,
  deleteGSheetConfig,
  setGSheetEnabled,
  extractSheetId,
} from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — return the current sheet config for this client. */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = await getGSheetConfig(clientId);
  return NextResponse.json({ config });
}

/** POST — save (upsert) the sheet config. */
export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
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

  const config = await saveGSheetConfig(clientId, {
    sheetId,
    tabName:       (body.tabName ?? "Sheet1").trim() || "Sheet1",
    campaignId,
    callStartHour,
    callEndHour,
  });
  return NextResponse.json({ ok: true, config });
}

/** PATCH — toggle enabled/disabled. */
export async function PATCH(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
  }
  await setGSheetEnabled(clientId, body.enabled);
  return NextResponse.json({ ok: true });
}

/** DELETE — disconnect the sheet and clear all lead records. */
export async function DELETE() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await deleteGSheetConfig(clientId);
  return NextResponse.json({ ok: true });
}
