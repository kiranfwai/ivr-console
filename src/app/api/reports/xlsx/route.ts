import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { Resvg } from "@resvg/resvg-js";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";
import { pieSvg, barSvg, type Slice, type Bar } from "@/lib/svg-charts";

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
const OUTCOME_COLOR_HEX: Record<string, string> = {
  press1: "#22c55e",
  connected: "#6366f1",
  busy: "#f59e0b",
  "no-answer": "#fbbf24",
  rejected: "#ef4444",
  error: "#dc2626",
  "in-progress": "#7a8597",
};
const OUTCOME_COLOR_ARGB: Record<string, string> = {
  press1: "FF22C55E",
  connected: "FF6366F1",
  busy: "FFF59E0B",
  "no-answer": "FFFBBF24",
  rejected: "FFEF4444",
  error: "FFDC2626",
  "in-progress": "FF7A8597",
};

function svgToPng(svg: string, width: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width * 2 },
    background: "rgba(15,18,24,1)",
  });
  return resvg.render().asPng();
}

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
  const press1Count = outcomeCounts.press1 || 0;

  // ----- chart PNGs -----
  const outcomeOrder = ["press1", "connected", "busy", "no-answer", "rejected", "error", "in-progress"];

  const liftedSlices: Slice[] = [
    { label: "Lifted", value: lifted, color: "#22c55e" },
    { label: "Not lifted", value: notLifted, color: "#f59e0b" },
    { label: "Other", value: calls.length - lifted - notLifted, color: "#7a8597" },
  ].filter((s) => s.value > 0);
  const pieLifted = svgToPng(pieSvg("Lifted vs not lifted", liftedSlices), 640);

  const outcomeSlices: Slice[] = outcomeOrder
    .filter((o) => outcomeCounts[o])
    .map((o) => ({ label: OUTCOME_LABEL[o], value: outcomeCounts[o], color: OUTCOME_COLOR_HEX[o] }));
  const pieOutcomes = svgToPng(pieSvg("Outcome breakdown", outcomeSlices), 640);

  const hourBars: Bar[] = [];
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0");
    if (hourCounts[key]) hourBars.push({ label: `${key}:00`, value: hourCounts[key] });
  }
  const barHour = svgToPng(barSvg("Calls by hour (UTC)", hourBars), 1280);

  const campEntries = Object.entries(campaignCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const campBars: Bar[] = campEntries.map(([name, value]) => ({ label: name, value }));
  const barCamp = svgToPng(barSvg("Calls by campaign", campBars), 1280);

  const outcomeBars: Bar[] = outcomeOrder
    .filter((o) => outcomeCounts[o])
    .map((o) => ({ label: OUTCOME_LABEL[o], value: outcomeCounts[o], color: OUTCOME_COLOR_HEX[o] }));
  const barOutcomes = svgToPng(barSvg("Outcomes (bar view)", outcomeBars), 1280);

  // ----- build workbook -----
  const wb = new ExcelJS.Workbook();
  wb.creator = "IVR Console";
  wb.created = new Date();

  // ============================================================
  // SHEET 1 — CALL LOGS  (one row per call, all detail)
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

  // Header row styling
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
    // Subtle zebra stripe
    if (row.number % 2 === 0) {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber === 5) return; // don't override the outcome fill
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      });
    }
  }

  logs.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: logs.columns.length },
  };

  // ============================================================
  // SHEET 2 — GRAPHS  (KPI strip on top, charts laid out below)
  // ============================================================
  const charts = wb.addWorksheet("Graphs", {
    views: [{ showGridLines: false }],
  });

  // Column widths — used as a layout grid for image positioning
  charts.columns = [
    { width: 22 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  // Title block
  const titleRow = charts.addRow(["IVR Console — Report"]);
  titleRow.font = { bold: true, size: 18, color: { argb: "FFE8ECF3" } };
  titleRow.height = 30;
  charts.mergeCells(titleRow.number, 1, titleRow.number, 13);

  const subRow = charts.addRow([`Range: ${day || (from && to ? `${from} → ${to}` : "all")}  ·  Campaign: ${campaignId || "all"}  ·  Generated ${new Date().toISOString()}`]);
  subRow.font = { size: 11, color: { argb: "FF7A8597" } };
  charts.mergeCells(subRow.number, 1, subRow.number, 13);

  charts.addRow([]);

  // KPI strip — 5 boxes across
  const kpis: { label: string; value: number | string; argb: string }[] = [
    { label: "TOTAL CALLS",      value: calls.length, argb: "FF5EEAD4" },
    { label: "LIFTED",           value: lifted,        argb: "FF22C55E" },
    { label: "PRESS 1",          value: press1Count,   argb: "FF22C55E" },
    { label: "NOT LIFTED",       value: notLifted,     argb: "FFF59E0B" },
    { label: "AVG DURATION",     value: `${avgDuration}s`, argb: "FFB8C0CF" },
  ];

  const kpiLabelRow = charts.addRow([]);
  const kpiValueRow = charts.addRow([]);
  kpiLabelRow.height = 18;
  kpiValueRow.height = 38;

  let colStart = 1;
  const kpiColSpan = 2; // each KPI spans 2 columns
  for (const k of kpis) {
    // Label
    charts.mergeCells(kpiLabelRow.number, colStart, kpiLabelRow.number, colStart + kpiColSpan);
    const labelCell = charts.getCell(kpiLabelRow.number, colStart);
    labelCell.value = k.label;
    labelCell.font = { size: 10, color: { argb: "FF7A8597" }, bold: true };
    labelCell.alignment = { vertical: "middle", horizontal: "center" };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1218" } };
    labelCell.border = topBottom("FF1F2531");
    // Value
    charts.mergeCells(kpiValueRow.number, colStart, kpiValueRow.number, colStart + kpiColSpan);
    const valueCell = charts.getCell(kpiValueRow.number, colStart);
    valueCell.value = k.value;
    valueCell.font = { size: 22, color: { argb: k.argb }, bold: true };
    valueCell.alignment = { vertical: "middle", horizontal: "center" };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1218" } };
    valueCell.border = topBottom("FF1F2531");
    colStart += kpiColSpan + 1; // 1-col gap between KPIs
  }

  // Spacer
  charts.addRow([]);
  charts.addRow([]);

  // Section header helper
  function sectionHeader(text: string) {
    const r = charts.addRow([text]);
    r.font = { bold: true, size: 13, color: { argb: "FF5EEAD4" } };
    r.height = 22;
    charts.mergeCells(r.number, 1, r.number, 13);
    charts.addRow([]); // breathing room
    return r.number;
  }

  // ─── Section 1: two pies side by side ─────────────────────
  sectionHeader("Outcome distribution");
  const pieRowStart = charts.rowCount; // 0-indexed reference for image placement

  // Reserve rows for the pies
  for (let i = 0; i < 17; i++) charts.addRow([]);

  const pieLiftedId = wb.addImage({ buffer: pieLifted as any, extension: "png" });
  charts.addImage(pieLiftedId, {
    tl: { col: 0, row: pieRowStart },
    ext: { width: 480, height: 280 },
  });
  const pieOutcomesId = wb.addImage({ buffer: pieOutcomes as any, extension: "png" });
  charts.addImage(pieOutcomesId, {
    tl: { col: 7, row: pieRowStart },
    ext: { width: 480, height: 280 },
  });

  charts.addRow([]);

  // ─── Section 2: outcomes bar (full width) ─────────────────
  sectionHeader("Outcomes — bar view");
  const barOutcomesRowStart = charts.rowCount;
  for (let i = 0; i < 16; i++) charts.addRow([]);
  const barOutcomesId = wb.addImage({ buffer: barOutcomes as any, extension: "png" });
  charts.addImage(barOutcomesId, {
    tl: { col: 0, row: barOutcomesRowStart },
    ext: { width: 960, height: 285 },
  });

  charts.addRow([]);

  // ─── Section 3: hourly bar (full width) ───────────────────
  sectionHeader("Calls by hour (UTC)");
  const barHourRowStart = charts.rowCount;
  for (let i = 0; i < 16; i++) charts.addRow([]);
  const barHourId = wb.addImage({ buffer: barHour as any, extension: "png" });
  charts.addImage(barHourId, {
    tl: { col: 0, row: barHourRowStart },
    ext: { width: 960, height: 285 },
  });

  charts.addRow([]);

  // ─── Section 4: campaigns bar (full width) ────────────────
  sectionHeader("Calls by campaign");
  const barCampRowStart = charts.rowCount;
  for (let i = 0; i < 16; i++) charts.addRow([]);
  const barCampId = wb.addImage({ buffer: barCamp as any, extension: "png" });
  charts.addImage(barCampId, {
    tl: { col: 0, row: barCampRowStart },
    ext: { width: 960, height: 285 },
  });

  // Ensure tab order
  wb.worksheets.sort((a, b) => {
    const order = ["Call Logs", "Graphs"];
    return order.indexOf(a.name) - order.indexOf(b.name);
  });

  const buf = await wb.xlsx.writeBuffer();
  const filenameRange = day || (from && to ? `${from}_to_${to}` : "all");
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ivr-report-${filenameRange}.xlsx"`,
    },
  });
}

function topBottom(argb: string): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin", color: { argb } },
    bottom: { style: "thin", color: { argb } },
  };
}
