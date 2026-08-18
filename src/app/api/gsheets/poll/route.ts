import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { listGSheetConns, getGSheetConn, pollClient } from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/gsheets/poll
 * Manually trigger a sheet poll for the current client.
 *
 * Body (optional):
 *   { connId: string } — poll a specific connection
 *                        (omit to poll all enabled connections for this client)
 *
 * The background poller calls pollAllClients() on its own interval;
 * this endpoint lets the user poll immediately from the UI.
 */
export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const connId: string | undefined = body?.connId || undefined;

  // Poll a specific connection
  if (connId) {
    const conn = await getGSheetConn(connId);
    if (!conn || conn.clientId !== clientId) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (!conn.enabled) {
      return NextResponse.json({ error: "Sheet sync is paused for this connection" }, { status: 400 });
    }
    const result = await pollClient(conn);
    return NextResponse.json({ ok: true, ...result });
  }

  // Poll all enabled connections for this client
  const conns = await listGSheetConns(clientId);
  const enabled = conns.filter((c) => c.enabled);
  if (!enabled.length) {
    return NextResponse.json({ error: "No active sheet connections" }, { status: 404 });
  }

  let totalNewRows = 0, totalCalled = 0, totalQueued = 0, totalFlushed = 0;
  const errors: string[] = [];

  for (const conn of enabled) {
    try {
      const r = await pollClient(conn);
      totalNewRows += r.newRows;
      totalCalled  += r.called;
      totalQueued  += r.queued;
      totalFlushed += r.flushed;
      if (r.error) errors.push(`[${conn.tabName}] ${r.error}`);
    } catch (e: any) {
      errors.push(`[${conn.tabName}] ${e?.message || "poll failed"}`);
    }
  }

  return NextResponse.json({
    ok: true,
    newRows: totalNewRows,
    called:  totalCalled,
    queued:  totalQueued,
    flushed: totalFlushed,
    ...(errors.length ? { error: errors.join("; ") } : {}),
  });
}
