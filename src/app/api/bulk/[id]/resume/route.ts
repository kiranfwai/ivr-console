import { NextRequest, NextResponse } from "next/server";
import { getBulkJob, resetDialingRows, setJobPaused } from "@/lib/bulk";
import { startWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/bulk/[id]/resume — Resume button. Recovers any rows stuck in
 * "dialing", un-pauses the job, and re-registers it so the backend worker
 * resumes draining the remaining pending rows.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await getBulkJob(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await resetDialingRows(params.id);
  const job = await setJobPaused(params.id, false);
  await startWorker(); // idempotent — ensures the ticker is running
  return NextResponse.json({ job });
}
