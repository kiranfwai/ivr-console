import { hmacBase64Url, constantTimeEqual } from "./hmac";

const COOKIE = "ivr_session";

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

function randomId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

export async function mintSessionCookie(): Promise<string> {
  const id = randomId();
  const sig = await hmacBase64Url(secret(), id);
  return `${id}.${sig}`;
}

export async function verifySessionCookie(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!id || !sig) return false;
  const expected = await hmacBase64Url(secret(), id);
  return constantTimeEqual(sig, expected);
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
