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

  const calls = await listCalls({ limit: 5000, day, from, to, campaignId });

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
