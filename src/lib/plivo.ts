import { hmacBase64, constantTimeEqual } from "./hmac";
import { takeCpsToken } from "./cps";

const AUTH_ID = () => process.env.PLIVO_AUTH_ID || "";
const AUTH_TOKEN = () => process.env.PLIVO_AUTH_TOKEN || "";
const DEFAULT_FROM = () => process.env.PLIVO_FROM_NUMBER || "+918031340818";

function authHeader(authId?: string, authToken?: string): string {
  const id = authId || AUTH_ID();
  const tok = authToken || AUTH_TOKEN();
  return "Basic " + Buffer.from(`${id}:${tok}`).toString("base64");
}

export interface PlaceCallOptions {
  to: string;
  answerUrl: string;
  hangupUrl?: string;
  callerName?: string;
  fromNumber?: string;
  answerMethod?: "GET" | "POST";
  // Per-client Plivo account. When absent, the shared env account is used, so
  // existing callers that pass no creds keep dialing exactly as before.
  authId?: string;
  authToken?: string;
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

  // Account-wide CPS gate: block until a token is free so the combined
  // initiation rate across all jobs + ad-hoc calls never exceeds PLIVO_CPS.
  // With this in place 429s should be rare; the loop below still handles any.
  await takeCpsToken();

  // Use the caller-supplied Plivo account when provided (a client's own account),
  // else the shared env account. accountId scopes the API URL to that account.
  const accountId = opts.authId || AUTH_ID();
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.plivo.com/v1/Account/${accountId}/Call/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader(opts.authId, opts.authToken) },
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

/**
 * Account-wide LIVE call count straight from Plivo (status=live) — this includes
 * calls placed by EVERY application on the same Plivo account, not just ours.
 *
 * The dashboard polls ~every 1s, so the result is cached for a few seconds to
 * stay well clear of Plivo's API rate limits. Returns null if the lookup fails
 * (the UI then falls back to this app's own live count). The live endpoint
 * returns { api_id, calls: [<uuid>, ...] }, so the concurrency is calls.length.
 */
let _liveCache: { at: number; count: number } | null = null;

export async function fetchAccountLiveCount(maxAgeMs = 3000): Promise<number | null> {
  const now = Date.now();
  if (_liveCache && now - _liveCache.at < maxAgeMs) return _liveCache.count;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://api.plivo.com/v1/Account/${AUTH_ID()}/Call/?status=live`,
      { headers: { Authorization: authHeader() }, signal: controller.signal },
    );
    if (!res.ok) return _liveCache?.count ?? null;
    const json: any = await res.json();
    const count = Array.isArray(json?.calls) ? json.calls.length : 0;
    _liveCache = { at: now, count };
    return count;
  } catch {
    return _liveCache?.count ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export interface PlivoNumber {
  number: string;            // digits as Plivo returns (no leading +)
  numberType: string;        // fixed | mobile | tollfree | ...
  country: string;
  region: string;
  voiceEnabled: boolean;
  smsEnabled: boolean;
  monthlyRentalRate: string; // as returned by Plivo (string)
  addedOn: string;
  application: string;
}

function mapPlivoNumber(o: any): PlivoNumber {
  return {
    number: String(o?.number ?? ""),
    numberType: String(o?.number_type ?? o?.type ?? ""),
    country: String(o?.country ?? ""),
    region: String(o?.region ?? ""),
    voiceEnabled: !!o?.voice_enabled,
    smsEnabled: !!o?.sms_enabled,
    monthlyRentalRate: String(o?.monthly_rental_rate ?? o?.carrier?.rate ?? ""),
    addedOn: String(o?.added_on ?? ""),
    application: String(o?.application ?? ""),
  };
}

/**
 * List ALL rented numbers on the Plivo account (GET /Number/), paging through
 * until every one is fetched. Read-only; uses the same Basic-auth creds as every
 * other call here. Returns the numbers plus the account-wide total. Bounded by a
 * hard page cap so a surprising response can never loop forever.
 */
export async function listAccountNumbers(
  creds?: { authId: string; authToken: string },
): Promise<{ numbers: PlivoNumber[]; total: number }> {
  const accountId = creds?.authId || AUTH_ID();
  const PAGE = 20;
  const MAX_PAGES = 50; // 1000 numbers — far beyond any real account
  const out: PlivoNumber[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let json: any;
    try {
      const res = await fetch(
        `https://api.plivo.com/v1/Account/${accountId}/Number/?limit=${PAGE}&offset=${offset}`,
        { headers: { Authorization: authHeader(creds?.authId, creds?.authToken) }, signal: controller.signal },
      );
      if (!res.ok) break;
      json = await res.json();
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }
    total = Number(json?.meta?.total_count ?? total) || total;
    const objects: any[] = Array.isArray(json?.objects) ? json.objects : [];
    for (const o of objects) out.push(mapPlivoNumber(o));
    if (objects.length < PAGE || out.length >= total) break;
  }
  // If Plivo didn't report a total, fall back to what we collected.
  if (!total) total = out.length;
  return { numbers: out, total };
}

/**
 * Validate a Plivo Auth ID + Token by hitting the account endpoint. Returns ok
 * only on HTTP 200. Used when a client connects their own account.
 */
export async function testPlivoCreds(
  authId: string,
  authToken: string,
): Promise<{ ok: boolean; status: number; name?: string }> {
  if (!authId || !authToken) return { ok: false, status: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.plivo.com/v1/Account/${authId}/`, {
      headers: { Authorization: authHeader(authId, authToken) },
      signal: controller.signal,
    });
    let name: string | undefined;
    if (res.ok) {
      const j: any = await res.json().catch(() => null);
      name = j?.name || j?.account_type || undefined;
    }
    return { ok: res.ok, status: res.status, name };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
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
export async function verifyPlivoSignature(
  req: Request,
  rawBody: string,
  authToken?: string,
): Promise<boolean> {
  const sigHeader = req.headers.get("x-plivo-signature-v3");
  const nonce = req.headers.get("x-plivo-signature-v3-nonce");
  if (!sigHeader || !nonce) return false;
  // The signature is computed with the token of the account that placed the call.
  // For a client-account call that's the client's token (passed in); else env.
  const token = authToken || AUTH_TOKEN();
  if (!token) return false;

  const url = req.url;
  const expected = await hmacBase64(token, nonce + url + rawBody);
  return constantTimeEqual(sigHeader, expected);
}

/**
 * Convenience: enforce signature if VERIFY_PLIVO_SIG=1, else allow. Reads body
 * once. `authToken` is the token of the account that placed the call (the
 * client's own when the callback carries ?client=…), falling back to env.
 */
export async function plivoGuard(req: Request, authToken?: string): Promise<{ ok: boolean; rawBody: string }> {
  const rawBody = req.method === "POST" ? await req.text() : "";
  if (process.env.VERIFY_PLIVO_SIG !== "1") return { ok: true, rawBody };
  const ok = await verifyPlivoSignature(req, rawBody, authToken);
  return { ok, rawBody };
}

export function parseFormBody(rawBody: string): URLSearchParams {
  return new URLSearchParams(rawBody);
}
