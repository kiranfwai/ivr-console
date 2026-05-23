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

function svgToPng(svg: string, width = 720): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width * 2 }, // 2x for retina-crisp
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

  // ----- build PNGs for charts -----
  const outcomeOrder = ["press1", "connected", "busy", "no-answer", "rejected", "error", "in-progress"];
  const pieSlices: Slice[] = outcomeOrder
    .filter((o) => outcomeCounts[o])
    .map((o) => ({ label: OUTCOME_LABEL[o], value: outcomeCounts[o], color: OUTCOME_COLOR_HEX[o] }));
  const outcomePiePng = svgToPng(pieSvg("Outcome breakdown", pieSlices), 720);

  const liftedVsNotPng = svgToPng(
    pieSvg("Lifted vs not lifted", [
      { label: "Lifted",     value: lifted,    color: "#22c55e" },
      { label: "Not lifted", value: notLifted, color: "#f59e0b" },
      { label: "Other",      value: calls.length - lifted - notLifted, color: "#7a8597" },
    ]),
    720
  );

  const hourBars: Bar[] = [];
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0");
    if (hourCounts[key]) hourBars.push({ label: `${key}:00`, value: hourCounts[key] });
  }
  const hourPng = svgToPng(barSvg("Calls by hour (UTC)", hourBars), 900);

  const campEntries = Object.entries(campaignCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const campBars: Bar[] = campEntries.map(([name, value]) => ({ label: name, value }));
  const campPng = svgToPng(barSvg("Calls by campaign", campBars), 900);

  const outcomeBars: Bar[] = outcomeOrder
    .filter((o) => outcomeCounts[o])
    .map((o) => ({ label: OUTCOME_LABEL[o], value: outcomeCounts[o], color: OUTCOME_COLOR_HEX[o] }));
  const outcomeBarPng = svgToPng(barSvg("Outcomes (bar view)", outcomeBars), 900);

  // ----- build workbook -----
  const wb = new ExcelJS.Workbook();
  wb.creator = "IVR Console";
  wb.created = new Date();

  // === SUMMARY ===
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 32 }, { width: 22 }];
  styleHeader(sum.addRow(["IVR Console — Report"]));
  sum.addRow([]);
  sum.addRow(["Range", day || (from && to ? `${from} → ${to}` : "all")]);
  sum.addRow(["Campaign filter", campaignId || "all"]);
  sum.addRow(["Generated", new Date().toISOString()]);
  sum.addRow(["Total calls", calls.length]);
  sum.addRow([]);
  styleHeader(sum.addRow(["KPIs"]));
  sum.addRow(["Lifted", lifted]);
  sum.addRow(["Lift rate (%)", calls.length ? Math.round((lifted / calls.length) * 100) : 0]);
  sum.addRow(["Press 1", outcomeCounts.press1 || 0]);
  sum.addRow(["Press-1 rate (%)", calls.length ? Math.round(((outcomeCounts.press1 || 0) / calls.length) * 100) : 0]);
  sum.addRow(["Not lifted (busy + no-answer)", notLifted]);
  sum.addRow(["Answered", answered]);
  sum.addRow(["Avg duration (sec)", avgDuration]);
  sum.addRow([]);

  // Embed the lifted-vs-not pie on the summary sheet
  const liftedId = wb.addImage({ buffer: liftedVsNotPng as any, extension: "png" });
  sum.addImage(liftedId, { tl: { col: 3, row: 1 }, ext: { width: 540, height: 320 } });

  // === CALLS (table) ===
  const calls_ = wb.addWorksheet("Calls");
  calls_.columns = [
    { header: "Triggered (UTC)", key: "triggered", width: 22 },
    { header: "To", key: "to", width: 16 },
    { header: "From", key: "from", width: 16 },
    { header: "Campaign", key: "campaign", width: 22 },
    { header: "Outcome", key: "outcome", width: 20 },
    { header: "Status", key: "status", width: 12 },
    { header: "Digit", key: "digit", width: 7 },
    { header: "Duration (s)", key: "duration", width: 12 },
    { header: "Answered at", key: "answered", width: 22 },
    { header: "Hangup at", key: "hangup", width: 22 },
    { header: "Hangup cause", key: "cause", width: 24 },
    { header: "Pabbly status", key: "pabbly", width: 13 },
    { header: "Call UUID", key: "uuid", width: 36 },
    { header: "Bulk job", key: "bulk", width: 20 },
  ];
  styleHeaderRow(calls_.getRow(1));
  for (const c of enriched) {
    const row = calls_.addRow({
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
    const argb = OUTCOME_COLOR_ARGB[c.outcome];
    if (argb) {
      row.getCell("outcome").fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb + "33" } };
      row.getCell("outcome").font = { color: { argb }, bold: true };
    }
  }
  calls_.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: calls_.columns.length } };
  calls_.views = [{ state: "frozen", ySplit: 1 }];

  // === OUTCOMES (pie + bar) ===
  const oc = wb.addWorksheet("Outcomes");
  oc.columns = [{ width: 24 }, { width: 10 }, { width: 10 }];
  styleHeaderRow(oc.addRow(["Outcome", "Count", "Share %"]));
  const maxOc = Math.max(1, ...Object.values(outcomeCounts));
  for (const o of outcomeOrder) {
    if (!outcomeCounts[o]) continue;
    const cnt = outcomeCounts[o];
    const pct = calls.length ? Math.round((cnt / calls.length) * 100) : 0;
    const row = oc.addRow([OUTCOME_LABEL[o], cnt, pct]);
    row.getCell(1).font = { color: { argb: OUTCOME_COLOR_ARGB[o] }, bold: true };
  }
  const ocPieId = wb.addImage({ buffer: outcomePiePng as any, extension: "png" });
  oc.addImage(ocPieId, { tl: { col: 4, row: 0 }, ext: { width: 540, height: 320 } });
  const ocBarId = wb.addImage({ buffer: outcomeBarPng as any, extension: "png" });
  oc.addImage(ocBarId, { tl: { col: 4, row: 18 }, ext: { width: 680, height: 285 } });

  // === HOURLY (bar) ===
  const hr = wb.addWorksheet("Hourly");
  hr.columns = [{ width: 12 }, { width: 10 }];
  styleHeaderRow(hr.addRow(["Hour (UTC)", "Calls"]));
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0");
    const cnt = hourCounts[key] || 0;
    if (cnt === 0) continue;
    hr.addRow([`${key}:00`, cnt]);
  }
  const hrBarId = wb.addImage({ buffer: hourPng as any, extension: "png" });
  hr.addImage(hrBarId, { tl: { col: 3, row: 0 }, ext: { width: 680, height: 285 } });

  // === CAMPAIGNS (bar) ===
  const cmp = wb.addWorksheet("Campaigns");
  cmp.columns = [{ width: 24 }, { width: 10 }, { width: 10 }];
  styleHeaderRow(cmp.addRow(["Campaign", "Calls", "Share %"]));
  for (const [name, cnt] of campEntries) {
    const pct = calls.length ? Math.round((cnt / calls.length) * 100) : 0;
    cmp.addRow([name, cnt, pct]);
  }
  const cmpBarId = wb.addImage({ buffer: campPng as any, extension: "png" });
  cmp.addImage(cmpBarId, { tl: { col: 4, row: 0 }, ext: { width: 680, height: 285 } });

  wb.worksheets.sort((a, b) => {
    const order = ["Summary", "Calls", "Outcomes", "Hourly", "Campaigns"];
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

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, size: 12, color: { argb: "FF5EEAD4" } };
}
function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFE8ECF3" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2531" } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
}
