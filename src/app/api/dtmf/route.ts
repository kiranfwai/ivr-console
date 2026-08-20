import { NextRequest } from "next/server";
import { plivoGuard, parseFormBody } from "@/lib/plivo";
import { sigTokenForClient } from "@/lib/plivo-config";
import { getCall, patchCall } from "@/lib/calls";
import { recordPress1 } from "@/lib/stats";
import { notifyWhatsapp } from "@/lib/whatsapp-notify";
import { redis } from "@/lib/redis";
import { runWithTenant } from "@/lib/tenant";

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
  const client = new URL(req.url).searchParams.get("client") || "";
  try {
    return await runWithTenant(client, () => handleInner(req));
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
  const sigClient = new URL(req.url).searchParams.get("client") || "";
  const guard = await plivoGuard(req, await sigTokenForClient(sigClient));
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
    // Press-1 still works and is still counted, whatever the campaign's trigger
    // is. What changed is that it is no longer the only way to earn the message:
    // on an "answer" campaign notifyWhatsapp() finds the send already claimed
    // from the pickup and does nothing, so the lead gets exactly one message.
    //
    // The webhook + recipient come ONLY from the stored record, never from the
    // request — signature verification is off by default, so an unauthenticated
    // POST to /api/dtmf?Digits=1&To=<any-number> must not be able to aim our
    // webhook at an arbitrary number.
    let pabblyStatus = 0;
    if (internalId && record) {
      const r = await notifyWhatsapp(internalId, { event: "press1", digit: "1", callUuid });
      pabblyStatus = r.status;
    }
    // Count the press-1 once (Plivo won't normally re-POST, but guard anyway).
    if (record && record.status !== "press1") await recordPress1(record);
    if (internalId) {
      await patchCall(internalId, {
        status: "press1",
        // Don't overwrite the status of a send that already happened on answer.
        ...(pabblyStatus ? { pabblyStatus } : {}),
      });
    }
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
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
