import { NextRequest, NextResponse } from "next/server";
import { plivoGuard, parseFormBody } from "@/lib/plivo";
import { getCall, patchCall } from "@/lib/calls";
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
    // Preserve press1 — it's the meaningful business outcome; hangup is the lifecycle event.
    const cur = await getCall(internalId);
    const keepPress1 = cur?.status === "press1";
    await patchCall(internalId, {
      status: keepPress1 ? "press1" : "hangup",
      hangupAt: new Date().toISOString(),
      durationSec: Number(duration) || 0,
      hangupCause: hangupCause || callStatus,
    });
  }
  return NextResponse.json({ ok: true });
}

export const GET = handle;
export const POST = handle;
