import { NextRequest, NextResponse } from "next/server";
import { claimBulkRows, getBulkJob, updateBulkRow } from "@/lib/bulk";
import { getCampaign } from "@/lib/campaigns";
import { placeCall, publicBaseUrl } from "@/lib/plivo";
import { normalizePhone } from "@/lib/phone";
import { recordCall } from "@/lib/calls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow up to 60s so parallel Plivo calls never hit a serverless timeout.
export const maxDuration = 60;

/**
 * POST /api/bulk/[id]/advance
 *
 * Server-side batch processor. Atomically claims `n` pending rows, fires them
 * as parallel Plivo calls, writes results back to Redis, and returns a summary.
 * The browser driver calls this once per batch interval instead of making
 * individual round-trips per contact — removing the per-call network overhead.
 *
 * Body: { n?: number (1-100, default 3), campaignId: string }
 * Response: { done: boolean, claimed: number, ok: number, failed: number, cpmHint?: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json().catch(() => ({}));
    const n = Math.min(Math.max(1, Number(body.n) || 3), 100);
    const campaignId: string = body.campaignId || "";

    if (!campaignId) {
      return NextResponse.json({ error: "campaignId required" }, { status: 400 });
    }

    // Resolve campaign and claim rows in parallel — one Redis read each.
    const [campaign, claimed] = await Promise.all([
      getCampaign(campaignId),
      claimBulkRows(params.id, n),
    ]);

    if (!campaign) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }

    // No more pending rows — job is done.
    if (!claimed.length) {
      return NextResponse.json({ done: true, claimed: 0, ok: 0, failed: 0 });
    }

    const base = publicBaseUrl(req);
    const triggeredAt = new Date().toISOString();

    // Fire all claimed rows in parallel — this is the main throughput win.
    const results = await Promise.all(
      claimed.map(async (row) => {
        const to = normalizePhone(row.phone);
        if (!to) {
          await updateBulkRow(params.id, row.index, {
            status: "failed",
            error: "invalid phone",
            attemptedAt: triggeredAt,
          });
          return { index: row.index, ok: false };
        }

        // Use enough entropy to survive concurrent ID generation in the same ms.
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

        // Write call record and bulk-row status in parallel (both are independent).
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
            bulkJobId: params.id,
          }),
          updateBulkRow(params.id, row.index, {
            status: result.ok ? "ok" : "failed",
            callUuid: internalId,
            attemptedAt: triggeredAt,
            error: result.ok ? undefined : `Plivo ${result.status}`,
          }),
        ]);

        return { index: row.index, ok: result.ok, to };
      }),
    );

    const okCount = results.filter((r) => r.ok).length;
    const failedCount = results.length - okCount;

    return NextResponse.json({
      done: false,
      claimed: claimed.length,
      ok: okCount,
      failed: failedCount,
    });
  } catch (e: any) {
    console.error("[advance] unhandled error:", e);
    return NextResponse.json({ error: e?.message || "internal error" }, { status: 500 });
  }
}
