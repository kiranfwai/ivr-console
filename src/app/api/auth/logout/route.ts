import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  // Also forget which client an admin was "viewing as". Otherwise the next admin
  // sign-in on this browser lands silently inside that client's console, where
  // calls and sends are charged to the client's wallet.
  res.cookies.set("ivr_admin_client", "", { sameSite: "lax", maxAge: 0, path: "/" });
  return res;
}
