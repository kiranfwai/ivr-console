import { NextRequest, NextResponse } from "next/server";
import { getBulkJob } from "@/lib/bulk";

export const dynamic = "force-dynamic";

/**
 * Returns the next pending row index for the browser driver to dial.
 * The driver then POSTs /api/call with { bulkJobId, bulkRowIndex } to fire it.
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const job = await getBulkJob(params.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const idx = job.rows.findIndex((r) => r.status === "pending");
  if (idx < 0) return NextResponse.json({ done: true });
  return NextResponse.json({
    done: false,
    index: idx,
    row: job.rows[idx],
    campaignId: job.campaignId,
    delayMs: job.delayMs,
  });
}
