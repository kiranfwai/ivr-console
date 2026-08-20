import { getCall, patchCall } from "./calls";
import { digitsOnly } from "./phone";
import type { CallRecord, WhatsappTrigger } from "./models";

/**
 * Firing the lead's WhatsApp message.
 *
 * The message is not sent from here — it is a POST to the campaign's Pabbly
 * webhook, and Pabbly does the sending. This module decides WHETHER to fire and
 * makes sure it happens at most once per call.
 *
 * Two places call it: the answer webhook (the lead picked up) and the DTMF
 * webhook (the lead pressed 1). Which of those actually sends is the campaign's
 * `whatsappTrigger`; the other one still records what happened, it just doesn't
 * message. Either way `whatsappSentAt` on the call record is the single guard
 * that stops a lead who answers AND presses 1 from getting two messages, and
 * stops a re-delivered Plivo callback from double-sending.
 */

/** A campaign with no explicit setting keeps the original press-1 behaviour. */
export function triggerOf(campaign: { whatsappTrigger?: WhatsappTrigger } | null): WhatsappTrigger {
  return campaign?.whatsappTrigger === "answer" ? "answer" : "press1";
}

export interface NotifyResult {
  sent: boolean;
  /** HTTP status from the webhook, 0 if not attempted, -1 if the request threw. */
  status: number;
  reason?: "already-sent" | "no-webhook" | "no-record";
}

/**
 * POST the campaign's webhook for this call, unless it has already been done.
 *
 * `digit` is passed through unchanged so an existing Pabbly workflow that
 * branches on it keeps working; `event` is new and says what actually caused
 * the send, which is what a workflow should branch on from now on.
 */
export async function notifyWhatsapp(
  internalId: string,
  opts: { event: "answered" | "press1"; digit?: string; callUuid?: string },
): Promise<NotifyResult> {
  const record = await getCall(internalId);
  if (!record) return { sent: false, status: 0, reason: "no-record" };
  if (record.whatsappSentAt) return { sent: false, status: 0, reason: "already-sent" };

  // The webhook and the recipient come ONLY from the stored record — never from
  // the incoming request. Signature verification is off by default, so trusting
  // the request would let an unauthenticated POST aim our webhook at any number.
  const webhook = record.webhookUrl || process.env.PABBLY_WEBHOOK_URL || "";
  if (!webhook) return { sent: false, status: 0, reason: "no-webhook" };

  const leadPhone = digitsOnly(record.to || "");
  const payload: Record<string, unknown> = {
    phone: leadPhone,
    lead: leadPhone,
    from: record.from,
    to: record.to,
    callUuid: opts.callUuid ?? record.callUuid,
    digit: opts.digit ?? "",
    event: opts.event,
    campaign: record.campaignName,
  };
  if (record.email) payload.email = record.email;

  // Claim the send BEFORE the request goes out. Losing a message because the
  // webhook was slow is better than sending the lead two.
  await patchCall(internalId, { whatsappSentAt: new Date().toISOString() });

  let status = 0;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // The answer webhook is on Plivo's critical path — a hanging webhook must
      // never hold up the XML that plays the audio.
      signal: AbortSignal.timeout(10000),
    });
    status = res.status;
  } catch {
    status = -1;
  }

  await patchCall(internalId, { pabblyStatus: status });
  return { sent: true, status };
}

/**
 * Fire the notification without making the caller wait for it.
 *
 * Used from the answer webhook, where Plivo is waiting on our XML: a slow Pabbly
 * would otherwise be heard by the lead as silence before the audio starts. The
 * app runs as a long-lived process, so the promise finishes after the response
 * has gone out.
 */
export function notifyWhatsappInBackground(
  internalId: string,
  opts: { event: "answered" | "press1"; digit?: string; callUuid?: string },
  record?: Pick<CallRecord, "to">,
): void {
  void notifyWhatsapp(internalId, opts).then(
    (r) => {
      if (r.sent) {
        console.info(`[whatsapp] ${opts.event} -> webhook ${r.status} for ${record?.to ?? internalId}`);
      } else if (r.reason !== "already-sent") {
        console.warn(`[whatsapp] ${opts.event} not sent (${r.reason}) for ${record?.to ?? internalId}`);
      }
    },
    (e) => console.error("[whatsapp] notify failed:", e),
  );
}
