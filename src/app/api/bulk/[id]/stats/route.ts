import { NextRequest, NextResponse } from "next/server";
import { getJobCounts } from "@/lib/bulk";

export const dynamic = "force-dynamic";

/**
 * GET /api/bulk/[id]/stats
 *
 * Returns only the running-counter hash for a job — a single O(1) Redis read.
 * The browser polls this every 2 s instead of fetching the full job blob,
 * eliminating the 504 timeouts caused by reading/deserialising 1.7 MB of
 * row data on every poll tick.
 *
 * Response: { total, pending, dialing, ok, failed, press1, connected,
 *             "no-answer", busy, rejected, error }
 */
export async function GET(
  _: NextRequest,
  { params }: { params: { id: string } },
) {
  const counts = await getJobCounts(params.id);
  if (!counts) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(counts);
}
