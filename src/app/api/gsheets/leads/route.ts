import { NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { listLeads, clearLeads } from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — list all leads for this client (newest first, up to 300). */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const leads = await listLeads(clientId);
  return NextResponse.json({ leads });
}

/** DELETE — clear all leads (keeps last_row pointer so no rows are re-processed). */
export async function DELETE() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await clearLeads(clientId);
  return NextResponse.json({ ok: true });
}
