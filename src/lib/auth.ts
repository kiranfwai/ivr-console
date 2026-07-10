import { hmacBase64Url, constantTimeEqual } from "./hmac";

const COOKIE = "ivr_session";

/**
 * Signed session cookie carrying WHO is logged in.
 *
 * Format: `<payload>.<sig>` where `payload` is base64url(JSON(session)) and
 * `sig = HMAC-SHA256(secret, payload)`. The payload is readable but tamper-proof
 * — the signature is verified on every request (in edge middleware, so it must
 * use only Web Crypto, which hmac.ts already does). Permissions are embedded so
 * middleware can authorize feature routes without a DB round-trip.
 */
export interface Session {
  uid: string; // "admin" for the env admin, else the client id
  role: "admin" | "client";
  cid: string; // tenant/client id for data scoping; "" for the admin
  perms: string[]; // granted feature-tab ids (admin is all-access, enforced separately)
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  // Fail closed in production: a known fallback secret means anyone can forge a
  // session cookie. Only fall back in non-production (local dev) for convenience.
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set — refusing to sign sessions with a default key in production.");
  }
  return "dev-secret-change-me";
}

// URL-safe base64 of a UTF-8 string (btoa/atob exist in both edge + node18+).
function b64urlEncode(s: string): string {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b64)));
}

export async function mintSessionCookie(session: Session): Promise<string> {
  const payload = b64urlEncode(JSON.stringify(session));
  const sig = await hmacBase64Url(secret(), payload);
  return `${payload}.${sig}`;
}

/** Verify the signature and return the decoded session, or null if invalid. */
export async function verifySessionCookie(value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!payload || !sig) return null;
  const expected = await hmacBase64Url(secret(), payload);
  if (!constantTimeEqual(sig, expected)) return null;
  try {
    const obj = JSON.parse(b64urlDecode(payload));
    if (!obj || (obj.role !== "admin" && obj.role !== "client")) return null;
    return {
      uid: String(obj.uid ?? ""),
      role: obj.role,
      cid: String(obj.cid ?? ""),
      perms: Array.isArray(obj.perms) ? obj.perms.map(String) : [],
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
