import { placeCall, publicBaseUrl } from "./plivo";
import { normalizePhone } from "./phone";
import { recordCall } from "./calls";
import { updateBulkRow } from "./bulk";
import type { Campaign, CallRecord } from "./models";

export interface PlaceCampaignCallInput {
  campaign: Campaign;
  phone: string;
  callerName?: string;
  email?: string;
  bulkJobId?: string;
  bulkRowIndex?: number;
  req?: Request; // only used to derive the public base URL for the webhooks
}

export interface PlaceCampaignCallResult {
  ok: boolean;
  status: number;
  to: string;
  callUuid: string;
  plivoRequestUuid?: string;
  answerUrl: string;
  plivo: unknown;
}

/**
 * The single source of truth for placing ONE campaign call via Plivo.
 *
 * Both the dashboard test call (POST /api/call) and the external trigger API
 * (POST /api/trigger-call) call this, so the dialing, the answer-URL wiring
 * (which plays the campaign audio) and the call record (which carries the
 * campaign's Pabbly webhook so the WhatsApp/email messages fire) are identical.
 *
 * Mint our own id BEFORE placing the call and use it as the canonical key
 * everywhere (answer URL `req`, call record key, bulk row link). Plivo's
 * request_uuid/CallUUID arrive later via the answer webhook and get aliased.
 */
export async function placeCampaignCall(input: PlaceCampaignCallInput): Promise<PlaceCampaignCallResult> {
  const { campaign, callerName, email, bulkJobId, bulkRowIndex, req } = input;
  const to = normalizePhone(String(input.phone));
  const base = publicBaseUrl(req);

  const internalId = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const answerUrl = `${base}/api/answer/${campaign.id}?req=${internalId}`;
  const hangupUrl = `${base}/api/hangup?req=${internalId}`;

  const result = await placeCall({
    to,
    answerUrl,
    hangupUrl,
    callerName: callerName || undefined,
    fromNumber: campaign.fromNumber || undefined,
  });

  const plivoRequestUuid = result.body && (result.body as any).request_uuid;

  const record: CallRecord = {
    callUuid: internalId,
    campaignId: campaign.id,
    campaignName: campaign.name,
    to,
    from: campaign.fromNumber || process.env.PLIVO_FROM_NUMBER || "",
    email: email || undefined,
    audioId: campaign.audioId,
    webhookUrl: campaign.webhookUrl || process.env.PABBLY_WEBHOOK_URL || "",
    status: result.ok ? "queued" : "failed",
    digit: "",
    triggeredAt: new Date().toISOString(),
    bulkJobId: bulkJobId || undefined,
  };
  await recordCall(record);

  if (bulkJobId && typeof bulkRowIndex === "number") {
    await updateBulkRow(bulkJobId, bulkRowIndex, {
      status: result.ok ? "ok" : "failed",
      callUuid: internalId,
      attemptedAt: record.triggeredAt,
      error: result.ok ? undefined : `Plivo ${result.status}`,
    });
  }

  return {
    ok: result.ok,
    status: result.status,
    to,
    callUuid: internalId,
    plivoRequestUuid,
    answerUrl,
    plivo: result.body,
  };
}
