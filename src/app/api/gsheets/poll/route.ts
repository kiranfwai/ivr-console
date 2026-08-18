import { NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getGSheetConfig, pollClient } from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/gsheets/poll
 * Manually trigger a sheet poll for the current client.
 * The background poller calls pollAllClients() on its own interval;
 * this endpoint lets the client poll immediately from the UI.
 */
export async function POST() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getGSheetConfig(clientId);
  if (!config) return NextResponse.json({ error: "No sheet configured" }, { status: 404 });
  if (!config.enabled) return NextResponse.json({ error: "Sheet sync is disabled" }, { status: 400 });

  const result = await pollClient(config);
  return NextResponse.json({ ok: true, ...result });
}
