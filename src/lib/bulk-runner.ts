import { updateBulkRow } from "./bulk";
import { placeCall } from "./plivo";
import { normalizePhone } from "./phone";
import { recordCall } from "./calls";
import type { Campaign } from "./models";

export interface ClaimedRow {
  index: number;
  phone: string;
  name?: string;
  email?: string;
}

/**
 * Place a single outbound call for one claimed row and write the result back to
 * just that row. Fired independently by the worker pump (no Promise.all over a
 * batch), so one slow Plivo request only holds its own slot — never the whole
 * job. placeCall() already has an AbortController timeout, so this always settles.
 */
export async function fireOne(
  jobId: string,
  row: ClaimedRow,
  campaign: Campaign,
  base: string,
): Promise<{ ok: boolean }> {
  const to = normalizePhone(row.phone);
  if (!to) {
    await updateBulkRow(jobId, row.index, {
      status: "failed",
      error: "invalid phone",
      attemptedAt: new Date().toISOString(),
    });
    return { ok: false };
  }

  const triggeredAt = new Date().toISOString();
  // Enough entropy to survive concurrent ID generation in the same ms.
  const internalId = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  const answerUrl = `${base}/api/answer/${campaign.id}?req=${internalId}`;
  const hangupUrl = `${base}/api/hangup?req=${internalId}`;

  const result = await placeCall({
    to,
    answerUrl,
    hangupUrl,
    callerName: row.name,
    fromNumber: campaign.fromNumber || undefined,
  });

  // A 429 means we were rate-limited, NOT that the number is bad. With the CPS
  // bucket gating placeCall this should be rare (only if PLIVO_CPS is set above
  // the account's real limit). Re-queue the row as 'pending' so the pump retries
  // it later, instead of burning it as a 'failed' outcome that pollutes the report.
  if (!result.ok && result.status === 429) {
    await updateBulkRow(jobId, row.index, {
      status: "pending",
      error: "rate-limited, requeued",
      attemptedAt: triggeredAt,
    });
    return { ok: false };
  }

  await recordCall({
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
  });

  await updateBulkRow(jobId, row.index, {
    status: result.ok ? "ok" : "failed",
    callUuid: internalId,
    attemptedAt: triggeredAt,
    error: result.ok ? undefined : `Plivo ${result.status}`,
  });

  return { ok: result.ok };
}
