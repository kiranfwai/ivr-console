import { NextRequest, NextResponse } from "next/server";
import { mintSessionCookie, SESSION_COOKIE, SESSION_MAX_AGE, type Session } from "@/lib/auth";
import { constantTimeEqual } from "@/lib/hmac";
import { verifyClientCredentials, FEATURES } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Email + password login.
 *  - The admin is env-based: email === ADMIN_EMAIL (default "admin@local") and
 *    password === ADMIN_PASSWORD → an all-access admin session.
 *  - Every other login is a client row (app_client), verified with scrypt →
 *    a client session scoped to that client's tenant + granted feature tabs.
 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ ok: false, error: "email and password required" }, { status: 400 });
  }
  const emailNorm = (typeof email === "string" ? email : "").trim().toLowerCase();

  let session: Session | null = null;

  const adminPass = process.env.ADMIN_PASSWORD;
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@local").toLowerCase();
  if (adminPass && emailNorm === adminEmail && constantTimeEqual(password, adminPass)) {
    session = { uid: "admin", role: "admin", cid: "", perms: [...FEATURES] };
  } else {
    const client = await verifyClientCredentials(emailNorm, password);
    if (client) {
      session = { uid: client.id, role: "client", cid: client.id, perms: client.perms };
    }
  }

  if (!session) {
    return NextResponse.json({ ok: false, error: "invalid email or password" }, { status: 401 });
  }

  const token = await mintSessionCookie(session);
  const res = NextResponse.json({ ok: true, role: session.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
