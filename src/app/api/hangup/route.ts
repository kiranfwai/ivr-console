import { NextRequest, NextResponse } from "next/server";
import { plivoGuard, parseFormBody } from "@/lib/plivo";
import { getCall, patchCall } from "@/lib/calls";
import { updateBulkRow } from "@/lib/bulk";
import { deriveOutcome } from "@/lib/outcome";
import { recordFinalized } from "@/lib/stats";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: NextRequest) {
  try {
    return await handleInner(req);
  } catch (e) {
    console.error("[hangup] error:", e);
    // Always 200 — Plivo retries on errors, and we'd rather lose one duration log than thrash.
    return NextResponse.json({ ok: true });
  }
}

async function handleInner(req: NextRequest) {
  const guard = await plivoGuard(req);
  if (!guard.ok) return NextResponse.json({ ok: false }, { status: 401 });

  const url = new URL(req.url);
  const reqParam = url.searchParams.get("req") || "";

  let callUuid = "";
  let callStatus = "";
  let duration = "";
  let hangupCause = "";
  if (req.method === "POST" && guard.rawBody) {
    const f = parseFormBody(guard.rawBody);
    callUuid = f.get("CallUUID") || "";
    callStatus = f.get("CallStatus") || "";
    duration = f.get("Duration") || "";
    hangupCause = f.get("HangupCause") || "";
  } else {
    callUuid = url.searchParams.get("CallUUID") || "";
    callStatus = url.searchParams.get("CallStatus") || "";
    duration = url.searchParams.get("Duration") || "";
    hangupCause = url.searchParams.get("HangupCause") || "";
  }

  let internalId = reqParam;
  if (!internalId && callUuid) {
    internalId = (await redis().get<string>(`callalias:${callUuid}`)) || callUuid;
  }

  if (internalId) {
    const cur = await getCall(internalId);
    const keepPress1 = cur?.status === "press1";
    const dur = Number(duration) || 0;
    const cause = hangupCause || callStatus;
    // Finalize the report counters once, on the first hangup only.
    if (cur && !cur.hangupAt) await recordFinalized(cur, cause, dur);
    await patchCall(internalId, {
      status: keepPress1 ? "press1" : "hangup",
      hangupAt: new Date().toISOString(),
      durationSec: dur,
      hangupCause: cause,
    });

    // Propagate outcome to the parent bulk row so the Bulk tab can show
    // accurate per-call results (not just "was the place-call request accepted").
    if (cur?.bulkJobId) {
      const bulkIndex = await findBulkRowIndex(cur.bulkJobId, internalId);
      if (bulkIndex !== -1) {
        const outcome = deriveOutcome(cause, cur.digit, !!cur.answeredAt);
        await updateBulkRow(cur.bulkJobId, bulkIndex, {
          status: outcome,
          hangupCause: cause,
          durationSec: dur,
        });
      }
    }
  }
  return NextResponse.json({ ok: true });
}

async function findBulkRowIndex(jobId: string, callUuid: string): Promise<number> {
  const job = await redis().get<{ rows: { callUuid?: string }[] }>(`bulk:${jobId}`);
  if (!job) return -1;
  return job.rows.findIndex((r) => r.callUuid === callUuid);
}

export const GET = handle;
export const POST = handle;
