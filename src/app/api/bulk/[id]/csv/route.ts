import { NextRequest } from "next/server";
import { getBulkJob, getAllRows } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Full-report CSV for one bulk campaign (FEATURE 6) — every recipient row with
 * its dialed outcome, duration and timestamp. Job-scoped (reads bulk_row), so it
 * is exactly this campaign, not a date range.
 */
const HEADER = ["index", "phone", "name", "email", "status", "hangupCause", "durationSec", "attemptedAt", "callUuid"];

function csvEscape(v: any): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  let job, rows;
  try {
    job = await getBulkJob(params.id);
    if (!job) return new Response("job not found", { status: 404 });
    rows = await getAllRows(params.id);
  } catch (e) {
    console.error("[bulk/csv] export failed:", e);
    return new Response("Export failed — the database is busy. Try again shortly.", { status: 503 });
  }

  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [r.idx, r.phone, r.name ?? "", r.email ?? "", r.status, r.hangupCause ?? "", r.durationSec ?? "", r.attemptedAt ?? "", r.callUuid ?? ""]
        .map(csvEscape)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-${params.id}.csv"`,
    },
  });
}
