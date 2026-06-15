import { claimBulkRows, updateBulkRow } from "./bulk";
import { placeCall } from "./plivo";
import { normalizePhone } from "./phone";
import { recordCall } from "./calls";
import type { Campaign } from "./models";

export interface FireResult {
  claimed: number;
  ok: number;
  failed: number;
}

/**
 * Claim up to `n` pending rows for a call-job, fire them as parallel Plivo calls,
 * and write the results back. Shared by the backend worker (server-driven loop)
 * and the legacy POST /api/bulk/[id]/advance route, so both behave identically.
 *
 * `base` is the public origin used to build Plivo answer/hangup callback URLs.
 * In a request it comes from publicBaseUrl(req); in the worker it comes from
 * publicBaseUrl() (PUBLIC_BASE_URL env), which is why that env var must be set.
 */
export async function fireBatch(
  jobId: string,
  campaign: Campaign,
  n: number,
  base: string,
): Promise<FireResult> {
  const claimed = await claimBulkRows(jobId, n);
  if (!claimed.length) return { claimed: 0, ok: 0, failed: 0 };

  const triggeredAt = new Date().toISOString();

  const results = await Promise.all(
    claimed.map(async (row) => {
      const to = normalizePhone(row.phone);
      if (!to) {
        await updateBulkRow(jobId, row.index, {
          status: "failed",
          error: "invalid phone",
          attemptedAt: triggeredAt,
        });
        return { ok: false };
      }

      // Enough entropy to survive concurrent ID generation in the same ms.
      const internalId = `c_${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 12)}`;
      const answerUrl = `${base}/api/answer/${campaign.id}?req=${internalId}`;
      const hangupUrl = `${base}/api/hangup?req=${internalId}`;

      const result = await placeCall({
        to,
        answerUrl,
        hangupUrl,
        callerName: row.name,
        fromNumber: campaign.fromNumber || undefined,
      });

      await Promise.all([
        recordCall({
          callUuid: internalId,
          campaignId: campaign.id,
          campaignName: campaign.name,
          to,
          from: campaign.fromNumber || process.env.PLIVO_FROM_NUMBER || "",
          email: row.email,
          audioId: campaign.audioId,
          webhookUrl: campaign.webhookUrl || process.env.PABBLY_WEBHOOK_URL || "",
          status: result.ok ? "queued" : "failed",
          digit: "",
          triggeredAt,
          bulkJobId: jobId,
        }),
        updateBulkRow(jobId, row.index, {
          status: result.ok ? "ok" : "failed",
          callUuid: internalId,
          attemptedAt: triggeredAt,
          error: result.ok ? undefined : `Plivo ${result.status}`,
        }),
      ]);

      return { ok: result.ok };
    }),
  );

  const ok = results.filter((r) => r.ok).length;
  return { claimed: claimed.length, ok, failed: results.length - ok };
}
