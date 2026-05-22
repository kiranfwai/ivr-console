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
  const res = await fetch(`https://api.plivo.com/v1/Account/${AUTH_ID()}/Call/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { ok: res.ok, status: res.status, body: json ?? text };
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
