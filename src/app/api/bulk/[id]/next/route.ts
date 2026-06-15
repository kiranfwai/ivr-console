import { NextRequest, NextResponse } from "next/server";
import { firstPendingRow, getBulkJob, setJobStatus } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the next pending row (inline). Used by the browser-paced WhatsApp
 * trickle driver. When nothing is pending, marks the job completed.
 */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const job = await getBulkJob(params.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await firstPendingRow(params.id);
  if (!row) {
    if (job.status !== "completed") await setJobStatus(params.id, "completed");
    return NextResponse.json({ done: true });
  }
  return NextResponse.json({
    done: false,
    index: row.index,
    row: { phone: row.phone, name: row.name, email: row.email },
    campaignId: job.campaignId,
    webhookUrl: job.webhookUrl,
    delayMs: job.delayMs,
  });
}
