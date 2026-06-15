import { NextRequest, NextResponse } from "next/server";
import { setJobStatus } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/bulk/[id]/pause — Stop. Sets status 'paused'; the worker stops
 * claiming new rows next tick (in-flight calls finish). Pending rows stay queued.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = await setJobStatus(params.id, "paused");
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job });
}
