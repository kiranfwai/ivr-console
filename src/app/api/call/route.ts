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
  const { phone, campaignId, callerName, bulkJobId, bulkRowIndex } = body;

  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
  if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  const campaign = await getCampaign(campaignId);
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  const to = normalizePhone(String(phone));
  const base = publicBaseUrl(req);

  // request_uuid won't exist yet — we use a placeholder id, then update once Plivo responds.
  const tempId = `pending_${Math.random().toString(36).slice(2, 10)}`;
  const answerUrl = `${base}/api/answer/${campaign.id}?req=${tempId}`;
  const hangupUrl = `${base}/api/hangup?req=${tempId}`;

  const result = await placeCall({
    to,
    answerUrl,
    hangupUrl,
    callerName: callerName || undefined,
    fromNumber: campaign.fromNumber || undefined,
  });

  const requestUuid = (result.body && (result.body as any).request_uuid) || tempId;

  const record: CallRecord = {
    callUuid: requestUuid,
    campaignId: campaign.id,
    campaignName: campaign.name,
    to,
    from: campaign.fromNumber || process.env.PLIVO_FROM_NUMBER || "",
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
      callUuid: requestUuid,
      attemptedAt: record.triggeredAt,
      error: result.ok ? undefined : `Plivo ${result.status}`,
    });
  }

  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    to,
    callUuid: requestUuid,
    answerUrl,
    plivo: result.body,
  });
}
