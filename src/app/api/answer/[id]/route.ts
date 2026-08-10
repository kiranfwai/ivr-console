import { NextRequest } from "next/server";
import { getCampaign } from "@/lib/campaigns";
import { getAudio } from "@/lib/audios";
import { plivoGuard, publicBaseUrl, parseFormBody } from "@/lib/plivo";
import { sigTokenForClient } from "@/lib/plivo-config";
import { patchCall, getCall } from "@/lib/calls";
import { recordAnswered } from "@/lib/stats";
import { redis } from "@/lib/redis";
import { runWithTenant } from "@/lib/tenant";

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
  // No session on a Plivo callback — the owning client rides on ?client (put
  // there when the call was placed) so all data reads/writes stay tenant-scoped.
  const client = new URL(req.url).searchParams.get("client") || "";
  try {
    return await runWithTenant(client, () => handleInner(req, params.id));
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
  const sigClient = new URL(req.url).searchParams.get("client") || "";
  const guard = await plivoGuard(req, await sigTokenForClient(sigClient));
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

  const client = url.searchParams.get("client") || "";
  const clientQ = client ? `&client=${encodeURIComponent(client)}` : "";
  const dtmfAction = `${base}/api/dtmf?req=${encodeURIComponent(req_)}${clientQ}`;

  // The audio plays INSIDE <GetDigits>, so a keypress during playback interrupts
  // the audio and is captured immediately (barge-in) — this is what makes Press-1
  // reliable while the message is still playing.
  //
  // Two attributes fix the "audio repeats + call never ends" bug:
  //   • retries="1"  — the audio is played exactly ONCE. (The old retries="3"
  //     replayed the whole message up to 3 times whenever no digit was pressed,
  //     which is what callers heard as "silence, then the audio again".)
  //   • timeout      — how long we wait for a digit AFTER the audio finishes.
  //     A short grace keeps a late press working without a long trailing silence;
  //     when it lapses we fall straight through to <Hangup/> and the call ends.
  //
  // A hard <Hangup/> follows, and the call also carries Plivo `time_limit`
  // (= the campaign's Call Ending Duration) as a backstop, so the call is
  // guaranteed to disconnect about one audio-length after it connects.
  const POST_AUDIO_GRACE_SEC = 4;

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <GetDigits action="${esc(dtmfAction)}" method="POST" timeout="${POST_AUDIO_GRACE_SEC}" numDigits="1" retries="1" validDigits="1" playBeep="false" redirect="true">
    <Play>${esc(audioUrl)}</Play>
  </GetDigits>
  <Hangup/>
</Response>`);
}

export const GET = handle;
export const POST = handle;
