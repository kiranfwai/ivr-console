import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE, type Session } from "./auth";

/** Decode + verify the current request's session cookie (node route handlers). */
export async function readSession(): Promise<Session | null> {
  const c = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionCookie(c);
}
