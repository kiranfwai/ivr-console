import { hmacBase64, constantTimeEqual } from "./hmac";

const AUTH_ID = () => process.env.PLIVO_AUTH_ID || "";
const AUTH_TOKEN = () => process.env.PLIVO_AUTH_TOKEN || "";
const DEFAULT_FROM = () => process.env.PLIVO_FROM_NUMBER || "+918031340818";

function authHeader(): string {
  return "Basic " + Buffer.from(`${AUTH_ID()}:${AUTH_TOKEN()}`).toString("base64");
}

export interface PlaceCallOptions {
  to: string;
  answerUrl: string;
  hangupUrl?: string;
  callerName?: string;
  fromNumber?: string;
  answerMethod?: "GET" | "POST";
}

// A single hung Plivo request must never wedge a whole batch: at high
// concurrency, fireBatch does Promise.all over many placeCall()s, so one
// fetch that never settles would stall the worker and leave rows stuck in
// "dialing". We bound every call with an AbortController timeout and turn any
// failure into a normal { ok:false } result instead of a throw.
const CALL_TIMEOUT_MS = Number(process.env.PLIVO_CALL_TIMEOUT_MS) || 25000;

// Exponential backoff is applied ONLY to HTTP 429 (Plivo CPS / rate limit).
// Every other status — including 4xx invalid-number and 5xx carrier errors —
// returns immediately so one bad number never slows the whole campaign.
const RL_MAX_RETRIES = Number(process.env.PLIVO_RL_MAX_RETRIES) || 4;
const RL_BASE_MS = Number(process.env.PLIVO_RL_BASE_MS) || 250;
const RL_MAX_BACKOFF_MS = Number(process.env.PLIVO_RL_MAX_BACKOFF_MS) || 4000;

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/** Backoff for the Nth 429 (0-based): capped exponential + full jitter, or Retry-After. */
function rateLimitDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, RL_MAX_BACKOFF_MS);
  }
  const capped = Math.min(RL_BASE_MS * 2 ** attempt, RL_MAX_BACKOFF_MS);
  return Math.round(capped / 2 + Math.random() * (capped / 2)); // full jitter
}

export async function placeCall(opts: PlaceCallOptions) {
  const body = {
    from: opts.fromNumber || DEFAULT_FROM(),
    to: opts.to,
    answer_url: opts.answerUrl,
    answer_method: opts.answerMethod || "POST",
    hangup_url: opts.hangupUrl,
    hangup_method: "POST",
    caller_name: opts.callerName,
  };

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.plivo.com/v1/Account/${AUTH_ID()}/Call/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader() },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Rate limited: back off and retry (only 429, only up to RL_MAX_RETRIES).
      if (res.status === 429 && attempt < RL_MAX_RETRIES) {
        const delay = rateLimitDelayMs(attempt, res.headers.get("retry-after"));
        clearTimeout(timer);
        await sleep(delay);
        continue;
      }

      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { ok: res.ok, status: res.status, body: json ?? text };
    } catch (e: any) {
      const status = e?.name === "AbortError" ? 408 : 0;
      return { ok: false, status, body: e?.name === "AbortError" ? "timeout" : e?.message || "fetch error" };
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function fetchCallDetail(callUuid: string) {
  const res = await fetch(
    `https://api.plivo.com/v1/Account/${AUTH_ID()}/Call/${callUuid}/`,
    { headers: { Authorization: authHeader() } }
  );
  if (!res.ok) return null;
  return res.json();
}

export async function listRecentCalls(limit = 20, offset = 0) {
  const res = await fetch(
    `https://api.plivo.com/v1/Account/${AUTH_ID()}/Call/?limit=${limit}&offset=${offset}`,
    { headers: { Authorization: authHeader() } }
  );
  if (!res.ok) return { objects: [] as any[] };
  return res.json();
}

export function publicBaseUrl(req?: Request): string {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (req) {
    const u = new URL(req.url);
    return `${u.protocol}//${u.host}`;
  }
  return "http://localhost:3000";
}

/**
 * Plivo X-Plivo-Signature-V3 verification.
 * Sign value = base64(hmacSHA256(authToken, nonce + url + body))
 * Body is empty string for GET; for POST it's the raw request body (we read the form back).
 */
export async function verifyPlivoSignature(req: Request, rawBody: string): Promise<boolean> {
  const sigHeader = req.headers.get("x-plivo-signature-v3");
  const nonce = req.headers.get("x-plivo-signature-v3-nonce");
  if (!sigHeader || !nonce) return false;
  const token = AUTH_TOKEN();
  if (!token) return false;

  const url = req.url;
  const expected = await hmacBase64(token, nonce + url + rawBody);
  return constantTimeEqual(sigHeader, expected);
}

/** Convenience: enforce signature if VERIFY_PLIVO_SIG=1, else allow. Reads body once. */
export async function plivoGuard(req: Request): Promise<{ ok: boolean; rawBody: string }> {
  const rawBody = req.method === "POST" ? await req.text() : "";
  if (process.env.VERIFY_PLIVO_SIG !== "1") return { ok: true, rawBody };
  const ok = await verifyPlivoSignature(req, rawBody);
  return { ok, rawBody };
}

export function parseFormBody(rawBody: string): URLSearchParams {
  return new URLSearchParams(rawBody);
}
