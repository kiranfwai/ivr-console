import { normalizePhone } from "./phone";

/**
 * Pabbly WhatsApp/email delivery helper.
 *
 * Every WhatsApp (and the email that Pabbly fires off the same webhook) goes out
 * as a POST to a Pabbly Connect webhook. This module centralises two things the
 * high-throughput bulk sender needs:
 *
 *   1. A single POST with retry + exponential backoff (so a transient 429/5xx or
 *      a dropped connection doesn't burn a lead as "failed").
 *   2. A small concurrency-limited map, so a batch of leads is sent in parallel
 *      up to a fixed fan-out instead of one-at-a-time.
 *
 * Throughput is ultimately paced by the caller (the browser fires batches on a
 * schedule to hit the configured messages/minute). This module just makes each
 * batch fast and resilient.
 */

export interface WaSendResult {
  ok: boolean;
  status: number;   // HTTP status (0 = network error, 408 = timeout)
  attempts: number; // how many POSTs were made (1 = succeeded first try)
  ms: number;       // wall-clock across all attempts
  body: string;     // first 500 chars of the last response body / error
}

// Retry only transient failures (429 rate-limit + 5xx). 4xx (bad webhook, bad
// payload) fail immediately — retrying can't help and would waste time.
const MAX_RETRIES = Number(process.env.PABBLY_MAX_RETRIES) || 3;
const BASE_MS = Number(process.env.PABBLY_RETRY_BASE_MS) || 400;
const MAX_BACKOFF_MS = Number(process.env.PABBLY_RETRY_MAX_MS) || 5000;
const TIMEOUT_MS = Number(process.env.PABBLY_TIMEOUT_MS) || 15000;

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/** Capped exponential backoff with full jitter; honours a Retry-After header. */
function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  }
  const capped = Math.min(BASE_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

/** Build the digits-only Pabbly payload (same shape Pabbly already receives). */
export function buildWaPayload(input: {
  phone: string;
  name?: string;
  email?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  // Normalize so every input form maps to the SAME WhatsApp number: bare
  // 10-digit, country-coded, E.164 (+91…) and leading-0 all collapse to
  // country-coded digits (no leading "+").
  const waPhone = normalizePhone(String(input.phone)).replace(/^\+/, "");
  return {
    phone: waPhone,
    ...(input.name ? { name: input.name } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.extra || {}),
  };
}

/** POST a payload to a Pabbly webhook with retry + exponential backoff. */
export async function postToPabbly(hook: string, payload: unknown): Promise<WaSendResult> {
  const t0 = Date.now();
  let status = 0;
  let body = "";

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      status = r.status;
      body = await r.text();
      if (r.ok) {
        return { ok: true, status, attempts: attempt + 1, ms: Date.now() - t0, body: body.slice(0, 500) };
      }
      // Transient server-side failure — back off and retry.
      if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt, r.headers.get("retry-after")));
        continue;
      }
      return { ok: false, status, attempts: attempt + 1, ms: Date.now() - t0, body: body.slice(0, 500) };
    } catch (e: any) {
      clearTimeout(timer);
      const timedOut = e?.name === "AbortError";
      status = timedOut ? 408 : 0;
      body = timedOut ? "timeout" : String(e?.message || e);
      // Network error / timeout is transient — retry.
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      return { ok: false, status, attempts: attempt + 1, ms: Date.now() - t0, body: body.slice(0, 500) };
    }
  }
}

/** Run `fn` over `items` with at most `limit` in flight at once. Order preserved. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const width = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
