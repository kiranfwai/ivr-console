import { NextRequest, NextResponse } from "next/server";
import { getJobWithCounts, jobDurationStats } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Post-campaign summary (FEATURE 6): job metadata + per-status counts plus the
 * answered-call duration sum/count, so the client can render avg/total call time
 * without polling those aggregates on every tick.
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const job = await getJobWithCounts(params.id);
    if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
    const duration = await jobDurationStats(params.id);
    return NextResponse.json({ job, durationSum: duration.sum, durationCount: duration.count });
  } catch (e) {
    console.error("[bulk/summary]", e);
    return NextResponse.json({ error: "Could not load summary." }, { status: 500 });
  }
}
