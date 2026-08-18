import { NextRequest, NextResponse } from "next/server";
import { plivoGuard, parseFormBody } from "@/lib/plivo";
import { sigTokenForClient } from "@/lib/plivo-config";
import { getCall, patchCall } from "@/lib/calls";
import { updateBulkRowByCallUuid } from "@/lib/bulk";
import { deriveOutcome } from "@/lib/outcome";
import { updateLeadOutcomeByCallUuid } from "@/lib/gsheets";
import { recordFinalized } from "@/lib/stats";
import { redis } from "@/lib/redis";
import { runWithTenant, currentClientId } from "@/lib/tenant";
import { getConnectedCallRate } from "@/lib/pricing";
import { charge } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(req: NextRequest) {
  const client = new URL(req.url).searchParams.get("client") || "";
  try {
    return await runWithTenant(client, () => handleInner(req));
  } catch (e) {
    console.error("[hangup] error:", e);
    // Always 200 — Plivo retries on errors, and we'd rather lose one duration log than thrash.
    return NextResponse.json({ ok: true });
  }
}

async function handleInner(req: NextRequest) {
  const sigClient = new URL(req.url).searchParams.get("client") || "";
  const guard = await plivoGuard(req, await sigTokenForClient(sigClient));
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
    const outcome = deriveOutcome(cause, cur?.digit, !!cur?.answeredAt);

    // Finalize the report counters once, on the first hangup only.
    if (cur && !cur.hangupAt) {
      await recordFinalized(cur, cause, dur);
      // Bill the client's wallet once per CONNECTED call (answered → outcome
      // "connected" or "press1"). Idempotent on the call id (ref) so Plivo
      // hangup retries never double-charge. Non-fatal: a billing hiccup must
      // never break call finalization, so we swallow + log.
      const clientId = currentClientId();
      if (clientId && (outcome === "connected" || outcome === "press1")) {
        try {
          const rate = await getConnectedCallRate(clientId);
          if (rate > 0) {
            await charge(clientId, rate, {
              ref: internalId,
              description: `Connected call${cur.to ? ` · ${cur.to}` : ""}`,
            });
          }
        } catch (e) {
          console.error("[hangup] wallet charge failed:", e);
        }
      }
    }
    await patchCall(internalId, {
      status: keepPress1 ? "press1" : "hangup",
      hangupAt: new Date().toISOString(),
      durationSec: dur,
      hangupCause: cause,
    });

    // Propagate the outcome to the parent bulk row by call UUID — a single
    // indexed update (no whole-job scan), so high call volume doesn't contend.
    if (cur?.bulkJobId) {
      await updateBulkRowByCallUuid(internalId, {
        status: outcome,
        hangupCause: cause,
        durationSec: dur,
      });
    }

    // Propagate the outcome to a GSheets lead if this call originated from one.
    // Non-fatal: a missed update just means the UI shows no outcome badge.
    try {
      await updateLeadOutcomeByCallUuid(internalId, outcome as import("@/lib/gsheets").CallOutcome, cause, dur);
    } catch (e) {
      console.error("[hangup] gsheet lead outcome update failed:", e);
    }
  }
  return NextResponse.json({ ok: true });
}

export const GET = handle;
export const POST = handle;
