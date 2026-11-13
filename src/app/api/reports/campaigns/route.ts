import { NextRequest, NextResponse } from "next/server";
import { campaignsInRange, istToday } from "@/lib/report-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The campaigns that had calls in a date range, with their call counts.
 * GET ?from=yyyy-mm-dd&to=yyyy-mm-dd  (IST days; defaults to today)
 * -> { from, to, campaigns: [{ id, name, calls }] }  most calls first.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const from = day || url.searchParams.get("from") || istToday();
  const to = day || url.searchParams.get("to") || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to must be yyyy-mm-dd" }, { status: 400 });
  }
  try {
    return NextResponse.json({ from, to, campaigns: await campaignsInRange(from, to) });
  } catch (e) {
    console.error("[reports/campaigns] failed:", e);
    return NextResponse.json({ error: "Could not load campaigns for this range." }, { status: 503 });
  }
}
