import { NextRequest, NextResponse } from "next/server";
import { placeCall, publicBaseUrl } from "@/lib/plivo";
import { normalizePhone } from "@/lib/phone";
import { getCampaign } from "@/lib/campaigns";
import { recordCall } from "@/lib/calls";
import { updateBulkRow } from "@/lib/bulk";
import type { CallRecord } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { phone, campaignId, callerName, email, bulkJobId, bulkRowIndex } = body;

  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campaign = await getCampaign(campaignId);
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const to = normalizePhone(String(phone));
  const base = publicBaseUrl(req);

  // Mint our own id BEFORE placing the call and use it as the canonical key everywhere
  // (URL query `req`, Redis record key, bulk row link). Plivo's request_uuid/CallUUID
  // arrive later via the answer webhook and get aliased to this id.
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

  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    to,
    callUuid: internalId,
    plivoRequestUuid,
    answerUrl,
    plivo: result.body,
  });
}
