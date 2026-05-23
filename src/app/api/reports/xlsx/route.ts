import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";

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
// ARGB hex (ExcelJS expects this format: alpha + RGB, no #)
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

  // ----- enrich + aggregate -----
  const enriched = calls.map((c) => ({
    ...c,
    outcome: c.hangupAt || c.status === "failed"
      ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt)
      : "in-progress",
  }));

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

  // ----- build workbook -----
  const wb = new ExcelJS.Workbook();
  wb.creator = "IVR Console";
  wb.created = new Date();

  // === SUMMARY SHEET ===
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

  styleHeader(sum.addRow(["Outcome breakdown"]));
  const outcomeOrder = ["press1", "connected", "busy", "no-answer", "rejected", "error", "in-progress"];
  for (const o of outcomeOrder) {
    if (!outcomeCounts[o]) continue;
    const row = sum.addRow([OUTCOME_LABEL[o], outcomeCounts[o]]);
    row.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: OUTCOME_COLOR_ARGB[o] + "33" }, // 20% alpha tint
    };
  }

  // === CALLS SHEET ===
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
    // Color-code the outcome cell
    const argb = OUTCOME_COLOR_ARGB[c.outcome];
    if (argb) {
      row.getCell("outcome").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: argb + "33" },
      };
      row.getCell("outcome").font = { color: { argb }, bold: true };
    }
  }
  calls_.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: calls_.columns.length },
  };
  calls_.views = [{ state: "frozen", ySplit: 1 }];

  // === OUTCOMES SHEET (with bar chart-style colored cells; ExcelJS lacks real
  //     chart objects, so we render a horizontal bar via conditional widths. Each
  //     row's "bar" cell uses a wide fill proportional to count.) ===
  const oc = wb.addWorksheet("Outcomes");
  oc.columns = [
    { header: "Outcome", key: "label", width: 24 },
    { header: "Count", key: "count", width: 10 },
    { header: "Share %", key: "pct", width: 10 },
    { header: "Bar (visual)", key: "bar", width: 50 },
  ];
  styleHeaderRow(oc.getRow(1));
  const maxOutcome = Math.max(1, ...Object.values(outcomeCounts));
  for (const o of outcomeOrder) {
    if (!outcomeCounts[o]) continue;
    const cnt = outcomeCounts[o];
    const pct = calls.length ? Math.round((cnt / calls.length) * 100) : 0;
    const barLen = Math.max(1, Math.round((cnt / maxOutcome) * 40));
    const row = oc.addRow({
      label: OUTCOME_LABEL[o],
      count: cnt,
      pct,
      bar: "█".repeat(barLen),
    });
    row.getCell("bar").font = { color: { argb: OUTCOME_COLOR_ARGB[o] }, name: "Consolas" };
  }

  // === HOURLY SHEET ===
  const hr = wb.addWorksheet("Hourly");
  hr.columns = [
    { header: "Hour (UTC)", key: "hour", width: 12 },
    { header: "Calls", key: "calls", width: 10 },
    { header: "Bar", key: "bar", width: 50 },
  ];
  styleHeaderRow(hr.getRow(1));
  const maxHour = Math.max(1, ...Object.values(hourCounts));
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0");
    const cnt = hourCounts[key] || 0;
    if (cnt === 0) continue;
    const barLen = Math.max(1, Math.round((cnt / maxHour) * 40));
    const row = hr.addRow({ hour: `${key}:00`, calls: cnt, bar: "█".repeat(barLen) });
    row.getCell("bar").font = { color: { argb: "FF5EEAD4" }, name: "Consolas" };
  }

  // === CAMPAIGNS SHEET ===
  const cmp = wb.addWorksheet("Campaigns");
  cmp.columns = [
    { header: "Campaign", key: "name", width: 24 },
    { header: "Calls", key: "calls", width: 10 },
    { header: "Share %", key: "pct", width: 10 },
    { header: "Bar", key: "bar", width: 50 },
  ];
  styleHeaderRow(cmp.getRow(1));
  const campEntries = Object.entries(campaignCounts).sort((a, b) => b[1] - a[1]);
  const maxCamp = Math.max(1, ...campEntries.map(([, v]) => v));
  for (const [name, cnt] of campEntries) {
    const pct = calls.length ? Math.round((cnt / calls.length) * 100) : 0;
    const barLen = Math.max(1, Math.round((cnt / maxCamp) * 40));
    const row = cmp.addRow({ name, calls: cnt, pct, bar: "█".repeat(barLen) });
    row.getCell("bar").font = { color: { argb: "FF5EEAD4" }, name: "Consolas" };
  }

  // Re-order so Summary is first (it already is, but ensure)
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
