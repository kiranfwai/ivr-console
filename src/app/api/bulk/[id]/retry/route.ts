import { NextRequest, NextResponse } from "next/server";
import { getBulkJob, createBulkJob } from "@/lib/bulk";
import { startWorker } from "@/lib/worker";
import { RETRY_STATUSES } from "@/lib/outcome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Create a new bulk job containing just the failed rows of an existing job.
 * Retry-able statuses: no-answer, busy, error, failed.
 * Skipped: press1 / connected / ok (engaged or already placed), rejected (invalid number).
 */
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const job = await getBulkJob(params.id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const failedRows = job.rows.filter((r) => RETRY_STATUSES.has(r.status));
  if (!failedRows.length) {
    return NextResponse.json({ error: "no retry-able rows in this job" }, { status: 400 });
  }

  const child = await createBulkJob({
    kind: job.kind,
    campaignId: job.campaignId,
    webhookUrl: job.webhookUrl,
    delayMs: job.delayMs,
    jitterPct: job.jitterPct,
    concurrency: job.concurrency,
    rows: failedRows.map((r) => ({ phone: r.phone, name: r.name })),
  });
  if ((job.kind ?? "call") === "call") await startWorker();

  return NextResponse.json({ job: child, retriedFrom: job.id, count: failedRows.length });
}
