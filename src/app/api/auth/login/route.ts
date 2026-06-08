import { NextRequest, NextResponse } from "next/server";
import { mintSessionCookie, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { constantTimeEqual } from "@/lib/hmac";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // Fail closed: never accept a hardcoded default password in any environment.
    return NextResponse.json(
      { ok: false, error: "server not configured (ADMIN_PASSWORD unset)" },
      { status: 500 }
    );
  }
  if (typeof password !== "string" || !constantTimeEqual(password, expected)) {
    return NextResponse.json({ ok: false, error: "wrong password" }, { status: 401 });
  }
  const token = await mintSessionCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
