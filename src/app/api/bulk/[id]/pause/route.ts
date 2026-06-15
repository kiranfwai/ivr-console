import { NextRequest, NextResponse } from "next/server";
import { setJobPaused } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/bulk/[id]/pause — Stop button. Pauses the job so the backend worker
 * skips it. Pending rows stay queued; resume continues from where it left off.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = await setJobPaused(params.id, true);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job });
}
