import { query } from "./db";
import { runWithTenant } from "./tenant";
import { patchCall } from "./calls";
import { digitsOnly, normalizePhone } from "./phone";
import { postToPabbly, mapWithConcurrency } from "./whatsapp";
import type { Campaign } from "./models";

/**
 * WhatsApp + email for EVERY lead of an "always" campaign.
 *
 * The answer / press-1 paths (whatsapp-notify.ts) only message a lead once the
 * call has a result. An "always" campaign messages the lead the moment their
 * call is placed, whatever happens next — answered, busy, no answer, failed —
 * and even when no call goes out at all (DND, low wallet). The message itself
 * is one POST to the campaign's Pabbly webhook; Pabbly sends WhatsApp + email.
 *
 * Exactly-once is carried by the `lead_notify` table, not by memory:
 *
 *   1. enqueueLeadNotify() INSERTs a 'pending' row keyed by `dedupe_key`
 *      (UNIQUE). A second enqueue for the same key — a re-poll, a manual
 *      re-call, a 429 re-dial, the same number in another sheet — is a no-op.
 *   2. The sender claims pending rows with FOR UPDATE SKIP LOCKED, so two
 *      sweeps can never take the same row, then records sent / failed.
 *   3. A row still 'sending' after a restart is marked 'unknown', never re-sent:
 *      a missed message is better than a duplicate one.
 *
 * Sending happens off the dial path, so a slow Pabbly never delays a call and a
 * burst (a whole sheet hitting a low wallet at once) is paced by the sweep.
 */

export type NotifySource = "sheet" | "bulk" | "call";

/** What happened to the call when the message was queued — sent to Pabbly as `call`. */
export type NotifyCallState = "placed" | "call_failed" | "dnd" | "low_balance";

export interface EnqueueLeadNotifyInput {
  clientId: string;
  source: NotifySource;
  dedupeKey: string;
  campaign: Pick<Campaign, "name" | "webhookUrl" | "fromNumber">;
  phone: string;
  name?: string | null;
  email?: string | null;
  /** Our internal call id when a call record exists, so the send shows on it. */
  callUuid?: string | null;
  /** Caller ID the call went out on (or would have). */
  from?: string | null;
  call: NotifyCallState;
}

/** Dedupe key for a Sheet Auto-Dial lead: one message per client + phone, across every sheet. */
export function sheetNotifyKey(clientId: string, phone: string): string {
  return `sheet:${clientId}:${normalizePhone(phone)}`;
}

/** Dedupe key for a row of a bulk call job (a 429 re-queue re-dials the same row). */
export function bulkNotifyKey(jobId: string, rowIndex: number): string {
  return `bulk:${jobId}:${rowIndex}`;
}

/** Dedupe key for a one-off call (dashboard test call, /api/trigger-call). */
export function callNotifyKey(internalId: string): string {
  return `call:${internalId}`;
}

/**
 * Queue this lead's message. Never throws — a notification problem must never
 * break the call it rides along with — and returns whether a new row was queued.
 */
export async function enqueueLeadNotify(input: EnqueueLeadNotifyInput): Promise<boolean> {
  try {
    const webhook = input.campaign.webhookUrl || process.env.PABBLY_WEBHOOK_URL || "";
    const lead = digitsOnly(normalizePhone(input.phone));
    if (!lead) return false;

    // Same shape the Pabbly workflow already maps for press-1 / answer sends,
    // plus `event` and `call` so the workflow can tell this send apart.
    const payload: Record<string, unknown> = {
      phone: lead,
      lead,
      to: lead,
      from: digitsOnly(input.from || ""),
      digit: "",
      campaign: input.campaign.name,
      callUuid: input.callUuid || "",
      event: "call_placed",
      call: input.call,
      source: input.source,
    };
    if (input.name) payload.name = input.name;
    const email = (input.email || "").trim();
    if (email) payload.email = email;
    // Pabbly's email step filters on this ("has_email = yes") so a lead with no
    // email still gets the WhatsApp and the email step is skipped cleanly.
    payload.has_email = email ? "yes" : "no";

    // No webhook: still write the row (as failed) so the lead is accounted for
    // and a later config fix can't suddenly message a backlog.
    const { rows } = await query<{ id: string }>(
      `INSERT INTO lead_notify
         (dedupe_key, client_id, source, phone, call_uuid, webhook_url, payload, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        input.dedupeKey,
        input.clientId || "",
        input.source,
        lead,
        input.callUuid || null,
        webhook,
        JSON.stringify(payload),
        webhook ? "pending" : "failed",
        webhook ? null : "no webhook configured (campaign or PABBLY_WEBHOOK_URL)",
      ],
    );
    if (!rows.length) return false; // already queued / sent for this lead

    if (webhook) kickLeadNotifier();
    return true;
  } catch (e) {
    console.error("[lead-notify] enqueue failed:", e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

const BATCH = Number(process.env.LEAD_NOTIFY_BATCH) || 25;
const CONCURRENCY = Number(process.env.LEAD_NOTIFY_CONCURRENCY) || 10;
const SWEEP_MS = Number(process.env.LEAD_NOTIFY_SWEEP_MS) || 5000;

type NotifyRow = {
  id: string;
  client_id: string;
  call_uuid: string | null;
  phone: string;
  webhook_url: string;
  payload: Record<string, unknown>;
};

const G = globalThis as unknown as {
  __ivrLeadNotifyRunning?: boolean;
  __ivrLeadNotifyAgain?: boolean;
  __ivrLeadNotifyStarted?: boolean;
};

/** Claim up to `n` pending rows. SKIP LOCKED: concurrent sweeps never share a row. */
async function claim(n: number): Promise<NotifyRow[]> {
  const { rows } = await query<NotifyRow>(
    `UPDATE lead_notify SET status = 'sending', claimed_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM lead_notify WHERE status = 'pending'
        ORDER BY id LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, client_id, call_uuid, phone, webhook_url, payload`,
    [n],
  );
  return rows;
}

async function sendOne(row: NotifyRow): Promise<void> {
  // No retry on timeout: Pabbly may have received it, and a second POST would
  // be a second WhatsApp. 429 / 5xx / refused connections are still retried.
  const res = await postToPabbly(row.webhook_url, row.payload, { retryOnTimeout: false });
  await query(
    `UPDATE lead_notify
        SET status = $2, http_status = $3, error = $4,
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
      WHERE id = $1`,
    [
      row.id,
      res.ok ? "sent" : res.status === 408 ? "unknown" : "failed",
      res.status,
      res.ok ? null : `Pabbly ${res.status || "error"}: ${res.body}`.slice(0, 500),
    ],
  );
  if (row.call_uuid) {
    // Show it on the call in Reports, like an answer / press-1 send.
    await runWithTenant(row.client_id, () =>
      patchCall(row.call_uuid!, {
        pabblyStatus: res.ok ? res.status : res.status || -1,
        ...(res.ok ? { whatsappSentAt: new Date().toISOString() } : {}),
      }),
    ).catch(() => {});
  }
  if (!res.ok) console.warn(`[lead-notify] ${row.phone}: Pabbly ${res.status} ${res.body.slice(0, 120)}`);
}

/** Send everything pending. Re-entrant calls just ask the running sweep to go round again. */
export async function sweepLeadNotifies(): Promise<void> {
  if (G.__ivrLeadNotifyRunning) {
    G.__ivrLeadNotifyAgain = true;
    return;
  }
  G.__ivrLeadNotifyRunning = true;
  try {
    do {
      G.__ivrLeadNotifyAgain = false;
      for (;;) {
        const rows = await claim(BATCH);
        if (!rows.length) break;
        await mapWithConcurrency(rows, CONCURRENCY, (r) =>
          sendOne(r).catch((e) => console.error(`[lead-notify] send ${r.id} failed:`, e)),
        );
      }
    } while (G.__ivrLeadNotifyAgain);
  } catch (e) {
    console.error("[lead-notify] sweep failed:", e);
  } finally {
    G.__ivrLeadNotifyRunning = false;
  }
}

/** Start a sweep now instead of waiting for the next tick. */
export function kickLeadNotifier(): void {
  void sweepLeadNotifies();
}

/** Boot: settle rows orphaned mid-send by a restart, then sweep on an interval. */
export async function startLeadNotifier(): Promise<void> {
  if (G.__ivrLeadNotifyStarted) return;
  G.__ivrLeadNotifyStarted = true;
  try {
    // Whether these reached Pabbly is unknowable, so they are NOT re-sent.
    const { rowCount } = await query(
      `UPDATE lead_notify SET status = 'unknown', error = 'interrupted by a restart mid-send'
        WHERE status = 'sending'`,
    );
    if (rowCount) console.warn(`[lead-notify] ${rowCount} send(s) interrupted by restart marked 'unknown'`);
  } catch (e) {
    console.error("[lead-notify] boot recovery failed:", e);
  }
  const timer = setInterval(() => void sweepLeadNotifies(), SWEEP_MS);
  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();
  console.info(`[lead-notify] sender started — sweep every ${SWEEP_MS / 1000}s`);
  kickLeadNotifier();
}
