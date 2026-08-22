import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getSheetReport, listSheetReportRows } from "@/lib/gsheet-report";
import { OUTCOME_LABEL, istStamp, reportFileSlug } from "@/lib/gsheet-report-format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = [
  "calledAtIST",
  "calledAtUTC",
  "sheetRow",
  "name",
  "email",
  "phone",
  "outcome",
  "durationSec",
  "hangupCause",
  "placementError",
  "removedFromQueue",
  "callUuid",
];

function csvEscape(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** GET /api/gsheets/report/csv?conn=&from=&to=&outcome= — lead-level export. */
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

  // Row-level export has to materialize every lead, so it is capped. The report
  // page shows the cap was hit; narrow the range for more.
  const EXPORT_CAP = 50000;

  let summary, rows;
  try {
    summary = await getSheetReport(clientId, connId, range);
    if (!summary) return NextResponse.json({ error: "Sheet connection not found" }, { status: 404 });
    rows = await listSheetReportRows(clientId, connId, { ...range, outcome, limit: EXPORT_CAP });
  } catch (e) {
    console.error("[gsheets/report/csv] export failed:", e);
    return new Response("Export failed — the database is busy. Try a narrower range.", { status: 503 });
  }
  if (rows.length >= EXPORT_CAP) {
    console.warn(`[gsheets/report/csv] hit the ${EXPORT_CAP}-row cap for conn=${connId}`);
  }

  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        istStamp(r.calledAt),
        r.calledAt,
        r.rowIndex,
        r.name ?? "",
        r.email ?? "",
        r.phone,
        OUTCOME_LABEL[r.outcome] ?? r.outcome,
        r.durationSec ?? "",
        r.hangupCause ?? "",
        r.error ?? "",
        r.removedFromQueue ? "yes" : "",
        r.callUuid ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFileSlug(summary)}.csv"`,
    },
  });
}
