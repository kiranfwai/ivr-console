import { placeCall, publicBaseUrl } from "./plivo";
import { normalizePhone } from "./phone";
import { recordCall } from "./calls";
import { updateBulkRow } from "./bulk";
import { currentClientId } from "./tenant";
import { canDial } from "./wallet";
import type { Campaign, CallRecord } from "./models";

/** Thrown by placeCampaignCall when the client's prepaid wallet can't cover a call. */
export class InsufficientBalanceError extends Error {
  code = "insufficient_balance" as const;
  constructor(public balance: number, public rate: number) {
    super("insufficient_balance");
    this.name = "InsufficientBalanceError";
  }
}

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
  // Carry the owning client on the webhook URLs so Plivo's (session-less)
  // answer/dtmf/hangup callbacks re-enter this client's data scope.
  const clientId = currentClientId() ?? "";

  // Prepaid gate: block dialing when the wallet can't cover a connected call.
  const gate = await canDial(clientId);
  if (!gate.ok) throw new InsufficientBalanceError(gate.balance, gate.rate);

  const cq = clientId ? `&client=${encodeURIComponent(clientId)}` : "";
  const answerUrl = `${base}/api/answer/${campaign.id}?req=${internalId}${cq}`;
  const hangupUrl = `${base}/api/hangup?req=${internalId}${cq}`;

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
