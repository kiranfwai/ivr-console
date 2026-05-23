import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";
import { injectCharts, type ChartSpec } from "@/lib/xlsx-charts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OUTCOME_LABEL: Record<string, string> = {
  press1: "Lifted + pressed 1",
  connected: "Lifted, no press",
  busy: "Busy",
  "no-answer": "Not lifted",
  rejected: "Rejected/invalid",
  error: "Carrier error",
  "in-progress": "In progress",
};
// no-# hex for the chart XML
const OUTCOME_COLOR_HEX: Record<string, string> = {
  press1: "22C55E",
  connected: "6366F1",
  busy: "F59E0B",
  "no-answer": "FBBF24",
  rejected: "EF4444",
  error: "DC2626",
  "in-progress": "7A8597",
};
// ARGB for cell styling
const OUTCOME_COLOR_ARGB: Record<string, string> = {
  press1: "FF22C55E",
  connected: "FF6366F1",
  busy: "FFF59E0B",
  "no-answer": "FFFBBF24",
  rejected: "FFEF4444",
  error: "FFDC2626",
  "in-progress": "FF7A8597",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const campaignId = url.searchParams.get("campaign") || undefined;

  const calls = await listCalls({ limit: 5000, day, from, to, campaignId });

  const enriched = calls.map((c) => ({
    ...c,
    outcome: c.hangupAt || c.status === "failed"
      ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt)
      : "in-progress",
  }));

  // ----- aggregates -----
  const outcomeCounts: Record<string, number> = {};
  const hourCounts: Record<string, number> = {};
  const campaignCounts: Record<string, number> = {};
  let totalDuration = 0;
  let answered = 0;
  for (const c of enriched) {
    outcomeCounts[c.outcome] = (outcomeCounts[c.outcome] || 0) + 1;
    const hour = c.triggeredAt.slice(11, 13);
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    const camp = c.campaignName || "(none)";
    campaignCounts[camp] = (campaignCounts[camp] || 0) + 1;
    if (c.answeredAt) {
      answered++;
      totalDuration += c.durationSec || 0;
    }
  }
  const avgDuration = answered ? Math.round(totalDuration / answered) : 0;
  const lifted = (outcomeCounts.press1 || 0) + (outcomeCounts.connected || 0);
  const notLifted = (outcomeCounts.busy || 0) + (outcomeCounts["no-answer"] || 0);
  const other = Math.max(0, calls.length - lifted - notLifted);
  const press1Count = outcomeCounts.press1 || 0;

  // ----- build workbook -----
  const wb = new ExcelJS.Workbook();
  wb.creator = "IVR Console";
  wb.created = new Date();

  // ============================================================
  // SHEET 1 — CALL LOGS
  // ============================================================
  const logs = wb.addWorksheet("Call Logs", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });

  logs.columns = [
    { header: "Triggered (UTC)", key: "triggered", width: 22 },
    { header: "To",              key: "to",        width: 16 },
    { header: "From",            key: "from",      width: 16 },
    { header: "Campaign",        key: "campaign",  width: 22 },
    { header: "Outcome",         key: "outcome",   width: 22 },
    { header: "Status",          key: "status",    width: 12 },
    { header: "Digit",           key: "digit",     width: 7 },
    { header: "Duration (s)",    key: "duration",  width: 12 },
    { header: "Answered at",     key: "answered",  width: 22 },
    { header: "Hangup at",       key: "hangup",    width: 22 },
    { header: "Hangup cause",    key: "cause",     width: 26 },
    { header: "Pabbly status",   key: "pabbly",    width: 13 },
    { header: "Call UUID",       key: "uuid",      width: 36 },
    { header: "Bulk job",        key: "bulk",      width: 22 },
  ];

  const hdr = logs.getRow(1);
  hdr.font = { bold: true, color: { argb: "FFE8ECF3" } };
  hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2531" } };
  hdr.alignment = { vertical: "middle", horizontal: "left" };
  hdr.height = 26;
  hdr.eachCell((cell) => {
    cell.border = { bottom: { style: "medium", color: { argb: "FF5EEAD4" } } };
  });

  for (const c of enriched) {
    const row = logs.addRow({
      triggered: c.triggeredAt,
      to: c.to,
      from: c.from,
      campaign: c.campaignName,
      outcome: OUTCOME_LABEL[c.outcome] || c.outcome,
      status: c.status,
      digit: c.digit || "",
      duration: c.durationSec ?? "",
      answered: c.answeredAt ?? "",
      hangup: c.hangupAt ?? "",
      cause: c.hangupCause ?? "",
      pabbly: c.pabblyStatus ?? "",
      uuid: c.callUuid,
      bulk: c.bulkJobId ?? "",
    });
    row.alignment = { vertical: "middle" };
    const argb = OUTCOME_COLOR_ARGB[c.outcome];
    if (argb) {
      row.getCell("outcome").fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb + "33" } };
      row.getCell("outcome").font = { color: { argb }, bold: true };
    }
  }

  logs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: logs.columns.length },
  };

  // ============================================================
  // SHEET 2 — GRAPHS
  //   Layout: title + KPIs at top, then DATA TABLES (which charts reference),
  //   then real native chart objects anchored next to / under each table.
  // ============================================================
  const charts = wb.addWorksheet("Graphs", { views: [{ showGridLines: false }] });
  charts.columns = Array.from({ length: 14 }, () => ({ width: 14 }));

  // --- Title block ---
  const titleRow = charts.addRow(["IVR Console — Report"]);
  titleRow.font = { bold: true, size: 18, color: { argb: "FFE8ECF3" } };
  titleRow.height = 30;
  charts.mergeCells(titleRow.number, 1, titleRow.number, 14);

  const subRow = charts.addRow([
    `Range: ${day || (from && to ? `${from} → ${to}` : "all")}  ·  Campaign: ${campaignId || "all"}  ·  Generated ${new Date().toISOString()}`,
  ]);
  subRow.font = { size: 11, color: { argb: "FF7A8597" } };
  charts.mergeCells(subRow.number, 1, subRow.number, 14);
  charts.addRow([]);

  // --- KPI strip ---
  const kpis: { label: string; value: number | string; argb: string }[] = [
    { label: "TOTAL CALLS",  value: calls.length, argb: "FF5EEAD4" },
    { label: "LIFTED",       value: lifted,       argb: "FF22C55E" },
    { label: "PRESS 1",      value: press1Count,  argb: "FF22C55E" },
    { label: "NOT LIFTED",   value: notLifted,    argb: "FFF59E0B" },
    { label: "AVG DURATION", value: `${avgDuration}s`, argb: "FFB8C0CF" },
  ];
  const kpiLabelRow = charts.addRow([]); kpiLabelRow.height = 18;
  const kpiValueRow = charts.addRow([]); kpiValueRow.height = 38;
  let colStart = 1;
  const span = 2;
  for (const k of kpis) {
    charts.mergeCells(kpiLabelRow.number, colStart, kpiLabelRow.number, colStart + span);
    const l = charts.getCell(kpiLabelRow.number, colStart);
    l.value = k.label;
    l.font = { size: 10, color: { argb: "FF7A8597" }, bold: true };
    l.alignment = { vertical: "middle", horizontal: "center" };
    l.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1218" } };

    charts.mergeCells(kpiValueRow.number, colStart, kpiValueRow.number, colStart + span);
    const v = charts.getCell(kpiValueRow.number, colStart);
    v.value = k.value;
    v.font = { size: 22, color: { argb: k.argb }, bold: true };
    v.alignment = { vertical: "middle", horizontal: "center" };
    v.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1218" } };
    colStart += span + 1;
  }
  charts.addRow([]); charts.addRow([]);

  // ============================================================
  // DATA TABLES (charts reference these cells by range)
  // We append each table tracking its starting row so we can build refs.
  // ============================================================
  function addSectionHeader(text: string): number {
    const r = charts.addRow([text]);
    r.font = { bold: true, size: 13, color: { argb: "FF5EEAD4" } };
    r.height = 22;
    charts.mergeCells(r.number, 1, r.number, 14);
    return r.number;
  }

  function addTableHeader(): number {
    const r = charts.addRow(["Label", "Count"]);
    r.font = { bold: true, color: { argb: "FFE8ECF3" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2531" } };
    return r.number;
  }

  // Each section gets a guaranteed CHART_ROWS-row vertical block so the chart
  // anchor (which is 18 rows tall for pies, 18 rows for bars) doesn't overlap
  // the next section's data table or header.
  const CHART_ROWS = 22;

  function padToSectionEnd(sectionStart: number) {
    while (charts.rowCount < sectionStart + CHART_ROWS) charts.addRow([]);
  }

  // --- Section 1: Lifted vs not lifted ---
  const s1Start = charts.rowCount + 1;
  addSectionHeader("Lifted vs not lifted");
  const t1Header = addTableHeader();
  const t1Rows = [
    ["Lifted", lifted],
    ["Not lifted", notLifted],
    ["Other", other],
  ].filter((r) => (r[1] as number) > 0) as [string, number][];
  for (const r of t1Rows) charts.addRow(r);
  const t1First = t1Header + 1;
  const t1Last = t1First + t1Rows.length - 1;
  padToSectionEnd(s1Start);

  // --- Section 2: Outcome breakdown ---
  const outcomeOrder = ["press1", "connected", "busy", "no-answer", "rejected", "error", "in-progress"];
  const t2Rows = outcomeOrder
    .filter((o) => outcomeCounts[o])
    .map((o) => ({ key: o, label: OUTCOME_LABEL[o], value: outcomeCounts[o] }));

  const s2Start = charts.rowCount + 1;
  addSectionHeader("Outcome breakdown");
  const t2Header = addTableHeader();
  for (const r of t2Rows) {
    const row = charts.addRow([r.label, r.value]);
    row.getCell(1).font = { color: { argb: OUTCOME_COLOR_ARGB[r.key] }, bold: true };
  }
  const t2First = t2Header + 1;
  const t2Last = t2First + t2Rows.length - 1;
  padToSectionEnd(s2Start);

  // --- Section 3: Calls by hour ---
  const s3Start = charts.rowCount + 1;
  addSectionHeader("Calls by hour (UTC)");
  const t3Header = charts.addRow(["Hour", "Calls"]);
  t3Header.font = { bold: true, color: { argb: "FFE8ECF3" } };
  t3Header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2531" } };
  const t3Rows: [string, number][] = [];
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0");
    if (hourCounts[key]) t3Rows.push([`${key}:00`, hourCounts[key]]);
  }
  for (const r of t3Rows) charts.addRow(r);
  const t3First = t3Header.number + 1;
  const t3Last = t3First + t3Rows.length - 1;
  padToSectionEnd(s3Start);

  // --- Section 4: Calls by campaign ---
  const s4Start = charts.rowCount + 1;
  addSectionHeader("Calls by campaign");
  const t4Header = charts.addRow(["Campaign", "Calls"]);
  t4Header.font = { bold: true, color: { argb: "FFE8ECF3" } };
  t4Header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2531" } };
  const t4Rows = Object.entries(campaignCounts).sort((a, b) => b[1] - a[1]).slice(0, 10) as [string, number][];
  for (const r of t4Rows) charts.addRow(r);
  const t4First = t4Header.number + 1;
  const t4Last = t4First + t4Rows.length - 1;
  padToSectionEnd(s4Start);

  // ============================================================
  // Build chart specs that reference the tables above.
  // Charts anchor in columns D..N (to the right of each data table).
  // ============================================================
  // Helper: build "A2:A4" style ranges from row indexes for col A (labels) and B (values)
  function r(col: "A" | "B", first: number, last: number) {
    return `${col}${first}:${col}${last}`;
  }

  const chartSpecs: ChartSpec[] = [];
  // Anchor charts so they span the entire section block (CHART_ROWS rows tall).
  // Pies need square-ish aspect: 8 cols × 21 rows ≈ ~512×316 px (close enough
  // for Excel to render proper circles after Excel's column-width defaults).
  // Bars get full width: 10 cols × 21 rows.
  if (t1Rows.length) {
    chartSpecs.push({
      type: "pie",
      title: "Lifted vs not lifted",
      dataSheet: "Graphs",
      labelRange: r("A", t1First, t1Last),
      valueRange: r("B", t1First, t1Last),
      anchor: { fromCol: 4, fromRow: s1Start - 1, toCol: 12, toRow: s1Start + CHART_ROWS - 2 },
      colors: ["22C55E", "F59E0B", "7A8597"].slice(0, t1Rows.length),
    });
  }
  if (t2Rows.length) {
    chartSpecs.push({
      type: "pie",
      title: "Outcome breakdown",
      dataSheet: "Graphs",
      labelRange: r("A", t2First, t2Last),
      valueRange: r("B", t2First, t2Last),
      anchor: { fromCol: 4, fromRow: s2Start - 1, toCol: 12, toRow: s2Start + CHART_ROWS - 2 },
      colors: t2Rows.map((r) => OUTCOME_COLOR_HEX[r.key]),
    });
  }
  if (t3Rows.length) {
    chartSpecs.push({
      type: "bar",
      title: "Calls by hour",
      dataSheet: "Graphs",
      labelRange: r("A", t3First, t3Last),
      valueRange: r("B", t3First, t3Last),
      anchor: { fromCol: 4, fromRow: s3Start - 1, toCol: 14, toRow: s3Start + CHART_ROWS - 2 },
      direction: "col",
      color: "5EEAD4",
    });
  }
  if (t4Rows.length) {
    chartSpecs.push({
      type: "bar",
      title: "Calls by campaign",
      dataSheet: "Graphs",
      labelRange: r("A", t4First, t4Last),
      valueRange: r("B", t4First, t4Last),
      anchor: { fromCol: 4, fromRow: s4Start - 1, toCol: 14, toRow: s4Start + CHART_ROWS - 2 },
      direction: "bar",
      color: "5EEAD4",
    });
  }

  // ensure tab order
  wb.worksheets.sort((a, b) => {
    const order = ["Call Logs", "Graphs"];
    return order.indexOf(a.name) - order.indexOf(b.name);
  });

  // Write base workbook, then splice in real chart objects
  const baseBuf = await wb.xlsx.writeBuffer();
  const finalBuf = await injectCharts(baseBuf as ArrayBuffer, "Graphs", chartSpecs);

  const filenameRange = day || (from && to ? `${from}_to_${to}` : "all");
  return new Response(finalBuf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ivr-report-${filenameRange}.xlsx"`,
    },
  });
}
