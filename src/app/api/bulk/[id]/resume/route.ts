import { NextRequest, NextResponse } from "next/server";
import { getBulkJob, resetDialingRows, setJobStatus } from "@/lib/bulk";
import { startWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/bulk/[id]/resume — Resume. Recovers any stale 'dialing' rows, sets
 * status 'running', and ensures the worker is up so it continues from the
 * remaining pending rows.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const existing = await getBulkJob(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  await resetDialingRows(params.id);
  const job = await setJobStatus(params.id, "running");
  await startWorker();
  return NextResponse.json({ job });
}
