import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getSheetReport, listSheetReportRows } from "@/lib/gsheet-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/gsheets/report?conn=<id>&from=&to=&outcome=&limit=&offset=
 *
 * What one Sheet Auto-Dial connection actually did: how many calls it placed in
 * an IST date range, what happened to them, and the lead behind each one.
 *
 * `from`/`to` are IST calendar days; omitting both reports all time.
 * `outcome` narrows the row list only — the summary always covers the range, so
 * the percentages don't move when you click a filter.
 */
export async function GET(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const connId = url.searchParams.get("conn") || "";
  if (!connId) return NextResponse.json({ error: "conn is required" }, { status: 400 });

  const range = {
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  };
  const outcome = url.searchParams.get("outcome") || undefined;
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "500")), 2000);
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));

  try {
    const summary = await getSheetReport(clientId, connId, range);
    // Also 404 when the connection belongs to somebody else — a client must not
    // be able to probe for the existence of another tenant's connection ids.
    if (!summary) return NextResponse.json({ error: "Sheet connection not found" }, { status: 404 });

    const rows = await listSheetReportRows(clientId, connId, { ...range, outcome, limit, offset });
    return NextResponse.json({ summary, rows, capped: rows.length >= limit });
  } catch (e) {
    console.error("[gsheets/report] failed:", e);
    return NextResponse.json({ error: "Could not build the report." }, { status: 503 });
  }
}
