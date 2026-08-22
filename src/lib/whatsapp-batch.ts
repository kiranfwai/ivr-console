import {
  getBulkJob, claimBulkRows, updateBulkRow, requeueStaleDialingRows,
  setJobStatus, countPending, countDialing,
} from "./bulk";
import { buildWaPayload, postToPabbly, mapWithConcurrency } from "./whatsapp";

/**
 * One batch of a WhatsApp bulk job.
 *
 * This used to live inside the send-batch route, which meant a bulk send only
 * progressed while a browser tab was open to pace it — close the tab and the
 * remaining messages simply never went. That is fine for a send you sit and
 * watch, and useless for a scheduled one, so the logic moved here where both
 * the route and the server-side worker can drive it.
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so the browser and the worker
 * running at the same time is safe: neither can claim the other's rows and a
 * recipient cannot be messaged twice.
 */

export const MAX_BATCH = 50;
export const MAX_CONCURRENCY = 25;
/**
 * A row left 'dialing' longer than this lost its sender — a closed tab, or a
 * restart mid-batch. Put it back so the next run picks it up rather than
 * stranding the recipient.
 */
export const STALE_DIALING_SEC = 120;

export interface BatchResult {
  done: boolean;
  claimed: number;
  sent: number;
  failed: number;
  error?: string;
}

export async function sendWhatsAppBatch(
  jobId: string,
  opts: { webhookUrl?: string | null; n?: number; concurrency?: number } = {},
): Promise<BatchResult> {
  const job = await getBulkJob(jobId);
  if (!job) return { done: true, claimed: 0, sent: 0, failed: 0, error: "not found" };

  const hook = opts.webhookUrl || job.webhookUrl || process.env.PABBLY_WEBHOOK_URL;
  if (!hook) return { done: false, claimed: 0, sent: 0, failed: 0, error: "no webhook configured" };

  const n = Math.max(1, Math.min(Number(opts.n) || 20, MAX_BATCH));
  const concurrency = Math.max(1, Math.min(Number(opts.concurrency) || n, MAX_CONCURRENCY));

  await requeueStaleDialingRows(jobId, STALE_DIALING_SEC).catch(() => {});

  const claimed = await claimBulkRows(jobId, n);
  if (!claimed.length) {
    if ((await countPending(jobId)) === 0 && (await countDialing(jobId)) === 0) {
      if (job.status !== "completed") await setJobStatus(jobId, "completed");
      return { done: true, claimed: 0, sent: 0, failed: 0 };
    }
    // Rows are in flight elsewhere — not finished, nothing to do this pass.
    return { done: false, claimed: 0, sent: 0, failed: 0 };
  }

  const attemptedAt = new Date().toISOString();
  const outcomes = await mapWithConcurrency(claimed, concurrency, async (row) => {
    const payload = buildWaPayload({ phone: row.phone, name: row.name, email: row.email });
    const res = await postToPabbly(hook, payload);
    await updateBulkRow(jobId, row.index, {
      status: res.ok ? "ok" : "failed",
      attemptedAt,
      error: res.ok ? undefined : `Pabbly ${res.status || "error"}`,
    }).catch(() => {});
    return res.ok;
  });

  const sent = outcomes.filter(Boolean).length;
  let done = false;
  if ((await countPending(jobId)) === 0 && (await countDialing(jobId)) === 0) {
    if (job.status !== "completed") await setJobStatus(jobId, "completed");
    done = true;
  }

  return { done, claimed: claimed.length, sent, failed: outcomes.length - sent };
}
