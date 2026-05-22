import { NextRequest } from "next/server";
import { plivoGuard, parseFormBody } from "@/lib/plivo";
import { getCall, patchCall } from "@/lib/calls";
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
    // SSRF fix: webhook comes from the *campaign* (stored at call time), never from the URL.
    const webhook = record?.webhookUrl || process.env.PABBLY_WEBHOOK_URL || "";
    let pabblyStatus = 0;
    if (webhook) {
      const leadPhone = digitsOnly(record?.to || to || "");
      try {
        const r = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: leadPhone,
            lead: leadPhone,
            from: record?.from || from,
            to: record?.to || to,
            callUuid,
            digit: "1",
            campaign: record?.campaignName,
          }),
        });
        pabblyStatus = r.status;
      } catch {
        pabblyStatus = -1;
      }
    }
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
