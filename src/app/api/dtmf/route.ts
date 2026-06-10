import { NextRequest } from "next/server";
import { plivoGuard, parseFormBody } from "@/lib/plivo";
import { getCall, patchCall } from "@/lib/calls";
import { recordPress1 } from "@/lib/stats";
import { digitsOnly } from "@/lib/phone";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function xml(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

async function resolveInternalId(req: string, callUuid: string): Promise<string | null> {
  if (req) return req;
  if (callUuid) {
    const alias = await redis().get<string>(`callalias:${callUuid}`);
    return alias ?? callUuid;
  }
  return null;
}

async function handle(req: NextRequest) {
  try {
    return await handleInner(req);
  } catch (e) {
    console.error("[dtmf] error:", e);
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-IN">Thank you. Goodbye.</Speak>
  <Hangup/>
</Response>`);
  }
}

async function handleInner(req: NextRequest) {
  const guard = await plivoGuard(req);
  if (!guard.ok) return xml(`<Response><Hangup/></Response>`, 401);

  const url = new URL(req.url);
  const reqParam = url.searchParams.get("req") || "";

  let digits = "";
  let from = "";
  let to = "";
  let callUuid = "";
  if (req.method === "POST" && guard.rawBody) {
    const f = parseFormBody(guard.rawBody);
    digits = f.get("Digits") || "";
    from = f.get("From") || "";
    to = f.get("To") || "";
    callUuid = f.get("CallUUID") || "";
  } else {
    digits = url.searchParams.get("Digits") || "";
    from = url.searchParams.get("From") || "";
    to = url.searchParams.get("To") || "";
    callUuid = url.searchParams.get("CallUUID") || "";
  }

  const internalId = await resolveInternalId(reqParam, callUuid);
  const record = internalId ? await getCall(internalId) : null;

  if (internalId) {
    await patchCall(internalId, { digit: digits, from: from || record?.from || "", to: to || record?.to || "" });
  }

  if (digits === "1") {
    // Abuse fix: only fire the webhook for a call we actually placed. Without this,
    // an unauthenticated GET/POST to /api/dtmf?Digits=1&To=<any-number> (signature
    // verification is off by default) would make us POST the Pabbly webhook to an
    // arbitrary number. The webhook + recipient come ONLY from the stored record —
    // never from the request query string.
    const webhook = record ? (record.webhookUrl || process.env.PABBLY_WEBHOOK_URL || "") : "";
    let pabblyStatus = 0;
    if (record && webhook) {
      const leadPhone = digitsOnly(record.to || "");
      try {
        const payload: any = {
          phone: leadPhone,
          lead: leadPhone,
          from: record.from,
          to: record.to,
          callUuid,
          digit: "1",
          campaign: record.campaignName,
        };
        if (record.email) payload.email = record.email;
        const r = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        pabblyStatus = r.status;
      } catch {
        pabblyStatus = -1;
      }
    }
    // Count the press-1 once (Plivo won't normally re-POST, but guard anyway).
    if (record && record.status !== "press1") await recordPress1(record);
    if (internalId) await patchCall(internalId, { status: "press1", pabblyStatus });
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-IN">Thank you. Your WhatsApp message is on its way. Goodbye.</Speak>
  <Hangup/>
</Response>`);
  }

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-IN">Invalid option. Goodbye.</Speak>
  <Hangup/>
</Response>`);
}

export const GET = handle;
export const POST = handle;
