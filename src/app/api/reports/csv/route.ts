import { NextRequest } from "next/server";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";

export const dynamic = "force-dynamic";

const HEADER = [
  "triggeredAt",
  "to",
  "from",
  "campaign",
  "outcome",
  "status",
  "digit",
  "durationSec",
  "answeredAt",
  "hangupAt",
  "hangupCause",
  "pabblyStatus",
  "callUuid",
  "bulkJobId",
];

function csvEscape(v: any): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const campaignId = url.searchParams.get("campaign") || undefined;

  // Row-level export must materialize records (unlike the counter-based KPIs).
  // Cap to keep the function within memory/time limits; narrow the range for more.
  const EXPORT_CAP = 50000;
  let calls;
  try {
    calls = await listCalls({ limit: EXPORT_CAP, day, from, to, campaignId });
  } catch (e) {
    console.error("[reports/csv] export failed:", e);
    return new Response("Export failed — the database is busy. Try a narrower range.", { status: 503 });
  }
  if (calls.length >= EXPORT_CAP) {
    console.warn(`[reports/csv] export hit ${EXPORT_CAP}-row cap for range ${from || day}..${to || day}`);
  }

  const lines = [HEADER.join(",")];
  for (const c of calls) {
    const outcome = c.hangupAt || c.status === "failed"
      ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt)
      : "in-progress";
    lines.push([
      c.triggeredAt,
      c.to,
      c.from,
      c.campaignName,
      outcome,
      c.status,
      c.digit,
      c.durationSec ?? "",
      c.answeredAt ?? "",
      c.hangupAt ?? "",
      c.hangupCause ?? "",
      c.pabblyStatus ?? "",
      c.callUuid,
      c.bulkJobId ?? "",
    ].map(csvEscape).join(","));
  }

  const body = lines.join("\n");
  const filenameRange = day || (from && to ? `${from}_to_${to}` : "all");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ivr-report-${filenameRange}.csv"`,
    },
  });
}
