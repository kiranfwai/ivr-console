import { NextRequest, NextResponse } from "next/server";
import {
  getBulkJob,
  claimBulkRows,
  updateBulkRow,
  requeueStaleDialingRows,
  setJobStatus,
  countPending,
  countDialing,
} from "@/lib/bulk";
import { buildWaPayload, postToPabbly, mapWithConcurrency } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Upper bounds so one request can't fan out unboundedly against Pabbly.
const MAX_BATCH = 50;
const MAX_CONCURRENCY = 25;
// A row 'dialing' longer than this lost its sender (e.g. the tab was closed
// mid-batch) — put it back to 'pending' so this run can pick it up again.
const STALE_DIALING_SEC = 120;

/**
 * Send ONE batch of a WhatsApp bulk job.
 *
 * Atomically claims up to `n` pending rows (FOR UPDATE SKIP LOCKED, so parallel
 * callers never double-send), fires them at Pabbly concurrently with retry, and
 * writes each row's outcome. The browser calls this on a schedule to hit the
 * configured messages/minute — this endpoint owns batching + concurrency + retry;
 * the browser owns pacing.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const job = await getBulkJob(params.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as any));
  const hook = body?.webhookUrl || job.webhookUrl || process.env.PABBLY_WEBHOOK_URL;
  if (!hook) return NextResponse.json({ error: "no webhook configured" }, { status: 500 });

  const n = Math.max(1, Math.min(Number(body?.n) || 20, MAX_BATCH));
  const concurrency = Math.max(1, Math.min(Number(body?.concurrency) || n, MAX_CONCURRENCY));

  // Recover rows orphaned in 'dialing' by an interrupted earlier run before we
  // claim, so they aren't stranded (the browser-paced sender has no worker sweep).
  await requeueStaleDialingRows(params.id, STALE_DIALING_SEC).catch(() => {});

  const claimed = await claimBulkRows(params.id, n);
  if (!claimed.length) {
    // Nothing left to claim. If nothing is pending or in flight, the job is done.
    if ((await countPending(params.id)) === 0 && (await countDialing(params.id)) === 0) {
      if (job.status !== "completed") await setJobStatus(params.id, "completed");
      return NextResponse.json({ done: true, claimed: 0, sent: 0, failed: 0 });
    }
    // Rows are mid-flight in another batch; ask the caller to poll again shortly.
    return NextResponse.json({ done: false, claimed: 0, sent: 0, failed: 0 });
  }

  const attemptedAt = new Date().toISOString();
  const outcomes = await mapWithConcurrency(claimed, concurrency, async (row) => {
    const payload = buildWaPayload({ phone: row.phone, name: row.name, email: row.email });
    const res = await postToPabbly(hook, payload);
    await updateBulkRow(params.id, row.index, {
      status: res.ok ? "ok" : "failed",
      attemptedAt,
      error: res.ok ? undefined : `Pabbly ${res.status || "error"}`,
    }).catch(() => {});
    return res.ok;
  });

  const sent = outcomes.filter(Boolean).length;
  const failed = outcomes.length - sent;

  // If that emptied the queue, close the job out so the UI flips to complete.
  let done = false;
  if ((await countPending(params.id)) === 0 && (await countDialing(params.id)) === 0) {
    if (job.status !== "completed") await setJobStatus(params.id, "completed");
    done = true;
  }

  return NextResponse.json({ done, claimed: claimed.length, sent, failed });
}
