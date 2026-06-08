import { NextRequest, NextResponse } from "next/server";
import { backfillStats } from "@/lib/calls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One-time (or resync) rebuild of the report counters from existing call records.
 * Auth-protected by the middleware (it lives under /api and is not in the public
 * prefix list). Process a bounded IST day range per call so a single invocation
 * stays within the function time limit — for very large histories, backfill a few
 * days at a time.
 *
 *   POST /api/reports/backfill?from=2026-05-01&to=2026-05-31
 *
 * Defaults to the last 31 days (inclusive) if no range is given.
 */
async function run(req: NextRequest) {
  const url = new URL(req.url);
  const todayMs = Date.now() + (5 * 60 + 30) * 60 * 1000; // IST wall clock
  const today = new Date(todayMs).toISOString().slice(0, 10);
  const defaultFrom = new Date(todayMs - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const from = url.searchParams.get("from") || defaultFrom;
  const to = url.searchParams.get("to") || today;

  const started = Date.now();
  const result = await backfillStats(from, to);
  return NextResponse.json({
    ok: true,
    from,
    to,
    scanned: result.scanned,
    daysWritten: result.daysWritten,
    ms: Date.now() - started,
  });
}

export const POST = run;
export const GET = run; // convenience: also runnable from the browser while logged in
