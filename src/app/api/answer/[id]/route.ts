import { NextRequest } from "next/server";
import { getCampaign } from "@/lib/campaigns";
import { getAudio } from "@/lib/audios";
import { plivoGuard, publicBaseUrl, parseFormBody } from "@/lib/plivo";
import { patchCall, getCall } from "@/lib/calls";
import { recordAnswered } from "@/lib/stats";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function xml(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handle(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return await handleInner(req, params.id);
  } catch (e) {
    console.error("[answer] error:", e);
    // Always give Plivo valid XML so the caller hears something coherent.
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN" language="en-IN">The service is temporarily unavailable. Please try again later. Goodbye.</Speak>
  <Hangup/>
</Response>`);
  }
}

async function handleInner(req: NextRequest, id: string) {
  const guard = await plivoGuard(req);
  if (!guard.ok) return xml(`<Response><Hangup/></Response>`, 401);

  const campaign = await getCampaign(id);
  if (!campaign) return xml(`<Response><Speak>Campaign not found. Goodbye.</Speak><Hangup/></Response>`);

  const audio = campaign.audioId ? await getAudio(campaign.audioId) : null;
  const base = publicBaseUrl(req);
  const url = new URL(req.url);
  const req_ = url.searchParams.get("req") || "";

  // Resolve audio URL: campaign audio, else first bundled fallback.
  const audioUrl =
    audio?.url ||
    `${base}/audios/day1.mp3`;

  // Capture CallUUID + numbers from Plivo's POST form body so we can link our record.
  let callUuid = "";
  let from = "";
  let to = "";
  if (req.method === "POST" && guard.rawBody) {
    const f = parseFormBody(guard.rawBody);
    callUuid = f.get("CallUUID") || "";
    from = f.get("From") || "";
    to = f.get("To") || "";
  } else {
    callUuid = url.searchParams.get("CallUUID") || "";
  }

  // Link Plivo's CallUUID -> our internal record (originally keyed by request_uuid).
  if (req_ && callUuid && req_ !== callUuid) {
    await redis().set(`callalias:${callUuid}`, req_, { ex: 60 * 60 * 24 * 7 });
  }
  if (req_) {
    const cur = await getCall(req_);
    if (cur) {
      // Count the answer once, on the first transition only (Plivo may re-POST).
      if (!cur.answeredAt) await recordAnswered(cur);
      await patchCall(req_, {
        status: "answered",
        answeredAt: new Date().toISOString(),
        from: from || cur.from,
        to: to || cur.to,
      });
    }
  }

  const dtmfAction = `${base}/api/dtmf?req=${encodeURIComponent(req_)}`;
  const prompt = campaign.prompt || "Press 1 to receive your WhatsApp message.";

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <GetDigits action="${esc(dtmfAction)}" method="POST" timeout="20" numDigits="1" retries="3" validDigits="0123456789" playBeep="true" redirect="true">
    <Play>${esc(audioUrl)}</Play>
    <Speak voice="WOMAN" language="en-IN">${esc(prompt)}</Speak>
  </GetDigits>
  <Speak voice="WOMAN" language="en-IN">We did not receive any input. Goodbye.</Speak>
  <Hangup/>
</Response>`);
}

export const GET = handle;
export const POST = handle;
