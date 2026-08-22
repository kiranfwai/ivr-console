import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentClientId } from "@/lib/tenant";
import { getSheetReport, listSheetReportRows } from "@/lib/gsheet-report";
import {
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  OUTCOME_COLOR,
  istStamp,
  reportFileSlug,
} from "@/lib/gsheet-report-format";
import { injectCharts, type ChartSpec } from "@/lib/xlsx-charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INK = "FFE8ECF3";
const MUTED = "FF7A8597";
const PANEL = "FF0F1218";
const HEADER_FILL = "FF161B24";

/** Chart XML wants bare hex; the shared palette carries the leading '#'. */
const hex = (c: string) => c.replace("#", "").toUpperCase();
const argb = (c: string) => `FF${hex(c)}`;

/** GET /api/gsheets/report/xlsx?conn=&from=&to=&outcome= */
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
  const EXPORT_CAP = 50000;

  let summary, rows;
  try {
    summary = await getSheetReport(clientId, connId, range);
    if (!summary) return NextResponse.json({ error: "Sheet connection not found" }, { status: 404 });
    rows = await listSheetReportRows(clientId, connId, { ...range, outcome, limit: EXPORT_CAP });
  } catch (e) {
    console.error("[gsheets/report/xlsx] export failed:", e);
    return new Response("Export failed — the database is busy. Try a narrower range.", { status: 503 });
  }
  if (rows.length >= EXPORT_CAP) {
    console.warn(`[gsheets/report/xlsx] hit the ${EXPORT_CAP}-row cap for conn=${connId}`);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "IVR Console";
  wb.created = new Date();

  // ==========================================================
  // SHEET 1 — CALL LOG (one row per lead that was dialled)
  // ==========================================================
  const log = wb.addWorksheet("Call Log", { views: [{ state: "frozen", ySplit: 1 }] });
  log.columns = [
    { header: "Called (IST)", key: "at", width: 18 },
    { header: "Sheet row", key: "row", width: 10 },
    { header: "Name", key: "name", width: 22 },
    { header: "Email", key: "email", width: 26 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Outcome", key: "outcome", width: 20 },
    { header: "Duration (s)", key: "dur", width: 12 },
    { header: "Hangup cause", key: "cause", width: 20 },
    { header: "Placement error", key: "err", width: 28 },
    { header: "Cleared from queue", key: "gone", width: 18 },
    { header: "Call UUID", key: "uuid", width: 38 },
  ];
  log.getRow(1).font = { bold: true, color: { argb: INK } };
  log.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };

  for (const r of rows) {
    const added = log.addRow({
      at: istStamp(r.calledAt),
      row: r.rowIndex,
      name: r.name ?? "",
      email: r.email ?? "",
      // Text, not a number — a leading + or 0 must survive the round trip.
      phone: r.phone,
      outcome: OUTCOME_LABEL[r.outcome] ?? r.outcome,
      dur: r.durationSec ?? "",
      cause: r.hangupCause ?? "",
      err: r.error ?? "",
      gone: r.removedFromQueue ? "yes" : "",
      uuid: r.callUuid ?? "",
    });
    const color = OUTCOME_COLOR[r.outcome];
    if (color) added.getCell("outcome").font = { color: { argb: argb(color) }, bold: true };
  }
  log.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: log.columns.length } };

  // ==========================================================
  // SHEET 2 — SUMMARY (KPIs, data tables, native charts)
  // ==========================================================
  const s = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  s.columns = Array.from({ length: 14 }, () => ({ width: 14 }));

  const title = s.addRow([`Sheet report — ${summary.connName}`]);
  title.font = { bold: true, size: 18, color: { argb: INK } };
  title.height = 30;
  s.mergeCells(title.number, 1, title.number, 14);

  const rangeLabel =
    summary.from && summary.to
      ? summary.from === summary.to
        ? summary.from
        : `${summary.from} → ${summary.to}`
      : "all time";
  const sub = s.addRow([
    `Tab: ${summary.tabName}  ·  Range (IST): ${rangeLabel}  ·  ` +
      `Rows in this file: ${rows.length}${outcome ? ` (filtered to ${OUTCOME_LABEL[outcome] ?? outcome})` : ""}` +
      `  ·  Generated ${istStamp(new Date().toISOString())} IST`,
  ]);
  sub.font = { size: 11, color: { argb: MUTED } };
  s.mergeCells(sub.number, 1, sub.number, 14);
  s.addRow([]);

  // --- KPI strip ---
  const kpis = [
    { label: "CALLS PLACED", value: summary.dialled, argb: "FF5EEAD4" },
    { label: "LIFTED", value: summary.lifted, argb: "FF22C55E" },
    { label: "PRESSED 1", value: summary.outcomes.press1 || 0, argb: "FF22C55E" },
    { label: "LIFT RATE", value: `${summary.liftRate}%`, argb: "FF5EEAD4" },
    { label: "AVG DURATION", value: `${summary.avgDurationSec}s`, argb: "FFB8C0CF" },
  ];
  const kpiLabels = s.addRow([]);
  kpiLabels.height = 18;
  const kpiValues = s.addRow([]);
  kpiValues.height = 38;
  let col = 1;
  for (const k of kpis) {
    s.mergeCells(kpiLabels.number, col, kpiLabels.number, col + 2);
    const l = s.getCell(kpiLabels.number, col);
    l.value = k.label;
    l.font = { size: 10, color: { argb: MUTED }, bold: true };
    l.alignment = { vertical: "middle", horizontal: "center" };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PANEL } };

    s.mergeCells(kpiValues.number, col, kpiValues.number, col + 2);
    const v = s.getCell(kpiValues.number, col);
    v.value = k.value;
    v.font = { size: 20, bold: true, color: { argb: k.argb } };
    v.alignment = { vertical: "middle", horizontal: "center" };
    v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PANEL } };
    col += 3;
  }
  s.addRow([]);

  /** Write a titled two-column table and return the data row range for a chart. */
  function table(heading: string, data: { label: string; value: number }[]) {
    const h = s.addRow([heading]);
    h.font = { bold: true, size: 13, color: { argb: INK } };
    s.mergeCells(h.number, 1, h.number, 3);
    const head = s.addRow(["", ""]);
    head.getCell(1).value = "Label";
    head.getCell(2).value = "Calls";
    head.font = { bold: true, color: { argb: MUTED } };
    const first = head.number + 1;
    for (const d of data) s.addRow([d.label, d.value]);
    const last = first + data.length - 1;
    // Chart block is 20 rows tall; keep the next section clear of it.
    const CHART_ROWS = 20;
    for (let i = data.length; i < CHART_ROWS; i++) s.addRow([]);
    s.addRow([]);
    return { first, last, top: h.number, empty: data.length === 0 };
  }

  const outcomeRows = OUTCOME_ORDER.filter((k) => (summary!.outcomes[k] || 0) > 0).map((k) => ({
    key: k,
    label: OUTCOME_LABEL[k] ?? k,
    value: summary!.outcomes[k],
  }));
  const t1 = table("Outcome breakdown", outcomeRows);
  const t2 = table(
    "Calls by day (IST)",
    summary.byDay.map((d) => ({ label: d.day, value: d.dialled })),
  );
  const t3 = table(
    "Calls by hour (IST)",
    Object.entries(summary.byHour).map(([h, n]) => ({ label: `${h}:00`, value: n })),
  );

  const specs: ChartSpec[] = [];
  if (!t1.empty) {
    specs.push({
      type: "pie",
      title: "Outcome breakdown",
      dataSheet: "Summary",
      labelRange: `A${t1.first}:A${t1.last}`,
      valueRange: `B${t1.first}:B${t1.last}`,
      anchor: { fromCol: 4, fromRow: t1.top, toCol: 12, toRow: t1.top + 20 },
      colors: outcomeRows.map((r) => hex(OUTCOME_COLOR[r.key] || "#7A8597")),
    });
  }
  if (!t2.empty) {
    specs.push({
      type: "bar",
      title: "Calls by day",
      dataSheet: "Summary",
      labelRange: `A${t2.first}:A${t2.last}`,
      valueRange: `B${t2.first}:B${t2.last}`,
      anchor: { fromCol: 4, fromRow: t2.top, toCol: 14, toRow: t2.top + 20 },
      direction: "col",
      color: "5EEAD4",
    });
  }
  if (!t3.empty) {
    specs.push({
      type: "bar",
      title: "Calls by hour",
      dataSheet: "Summary",
      labelRange: `A${t3.first}:A${t3.last}`,
      valueRange: `B${t3.first}:B${t3.last}`,
      anchor: { fromCol: 4, fromRow: t3.top, toCol: 14, toRow: t3.top + 20 },
      direction: "col",
      color: "6366F1",
    });
  }

  wb.worksheets.sort((a, b) => ["Summary", "Call Log"].indexOf(a.name) - ["Summary", "Call Log"].indexOf(b.name));

  const base = await wb.xlsx.writeBuffer();
  const final = await injectCharts(base as ArrayBuffer, "Summary", specs);

  return new Response(final, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportFileSlug(summary)}.xlsx"`,
    },
  });
}
