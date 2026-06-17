import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/answer",
  "/api/dtmf",
  "/api/hangup",
  "/api/trigger-call", // guarded by its own x-api-key header, not the session cookie
  "/audios",
  "/_next",
  "/favicon",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionCookie(cookie)) return NextResponse.next();

  if (pathname.startsWith("/api")) {
    return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
