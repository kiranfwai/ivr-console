import { NextRequest, NextResponse } from "next/server";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";

export const dynamic = "force-dynamic";

/**
 * Phone-number-level drill-down for the Reports campaign table (FEATURE 3).
 * GET ?campaign=<id>&from=&to=&status=&limit=
 *   status (optional): connected | failed | no-answer | busy
 * Returns each call's number, derived outcome, duration and timestamp.
 */
const STATUS_GROUPS: Record<string, Set<string>> = {
  connected: new Set(["press1", "connected"]),
  busy: new Set(["busy"]),
  "no-answer": new Set(["no-answer"]),
  failed: new Set(["rejected", "error", "failed"]),
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign") || undefined;
  const day = url.searchParams.get("day") || undefined;
  const from = day || url.searchParams.get("from") || undefined;
  const to = day || url.searchParams.get("to") || from;
  const status = url.searchParams.get("status") || "";
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "1000")), 5000);

  if (!campaignId) {
    return NextResponse.json({ error: "campaign required" }, { status: 400 });
  }

  try {
    const calls = await listCalls({ campaignId, from, to, limit });
    const group = STATUS_GROUPS[status];

    const rows = calls
      .map((c) => {
        const settled = c.hangupAt || c.status === "failed";
        const outcome = settled ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt) : "in-progress";
        return {
          to: c.to,
          outcome,
          durationSec: c.durationSec ?? null,
          triggeredAt: c.triggeredAt,
          digit: c.digit || "",
          hangupCause: c.hangupCause ?? null,
        };
      })
      .filter((r) => (group ? group.has(r.outcome) : true));

    return NextResponse.json({ rows, total: rows.length, capped: calls.length >= limit });
  } catch (e) {
    console.error("[reports/calls] failed:", e);
    return NextResponse.json({ error: "Could not load call detail." }, { status: 503 });
  }
}
