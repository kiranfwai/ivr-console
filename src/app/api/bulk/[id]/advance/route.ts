import { NextRequest, NextResponse } from "next/server";
import { getCampaign } from "@/lib/campaigns";
import { publicBaseUrl } from "@/lib/plivo";
import { fireBatch } from "@/lib/bulk-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow up to 60s so parallel Plivo calls never hit a serverless timeout.
export const maxDuration = 60;

/**
 * POST /api/bulk/[id]/advance
 *
 * Legacy single-batch endpoint, kept for back-compat. Calls are now driven by
 * the in-process backend worker (see src/lib/worker.ts); this just fires one
 * batch on demand using the same shared fireBatch() core.
 *
 * Body: { n?: number (1-100, default 3), campaignId: string }
 * Response: { done: boolean, claimed: number, ok: number, failed: number }
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

    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }

    const r = await fireBatch(params.id, campaign, n, publicBaseUrl(req));
    if (!r.claimed) {
      return NextResponse.json({ done: true, claimed: 0, ok: 0, failed: 0 });
    }
    return NextResponse.json({ done: false, ...r });
  } catch (e: any) {
    console.error("[advance] unhandled error:", e);
    return NextResponse.json({ error: e?.message || "internal error" }, { status: 500 });
  }
}
