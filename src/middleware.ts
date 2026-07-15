import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie, SESSION_COOKIE, type Session } from "@/lib/auth";

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  "/api/answer",
  "/api/dtmf",
  "/api/hangup",
  "/api/trigger-call", // guarded by its own x-api-key header, not the session cookie
  "/api/wallet/cashfree/webhook", // server-to-server from Cashfree; verified by signature, not cookie
  "/audios",
  "/_next",
  "/favicon",
  "/fwai-logo", // login-page logo, served before auth
];

// Admin-only. Everything under here requires role === "admin".
const ADMIN_PREFIXES = ["/api/admin"];

/**
 * The feature-tab permission an API path requires, or null if any logged-in user
 * may call it. Reads of shared reference data (campaign / audio lists, needed by
 * the Dial and Bulk tabs) stay open — only *managing* campaigns/audios needs the
 * matching perm. Action + read-only endpoints (call, bulk, reports, whatsapp)
 * are gated wholesale.
 */
function requiredFeature(path: string, method: string): string | null {
  if (path.startsWith("/api/call")) return "dial";
  if (path.startsWith("/api/bulk")) return "bulk";
  if (path.startsWith("/api/whatsapp")) return "whatsapp";
  if (path.startsWith("/api/reports")) return "reports";
  if (path.startsWith("/api/wallet")) return "billing";
  if (path.startsWith("/api/campaigns")) return method === "GET" ? null : "campaigns";
  if (path.startsWith("/api/audios")) return method === "GET" ? null : "audios";
  return null;
}

function unauthorized(isApi: boolean, req: NextRequest, status = 401) {
  if (isApi) {
    return new NextResponse(JSON.stringify({ error: status === 403 ? "forbidden" : "unauthorized" }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith("/api");
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const session: Session | null = await verifySessionCookie(cookie);
  if (!session) return unauthorized(isApi, req, 401);

  const isAdmin = session.role === "admin";

  // Admin-only surfaces.
  if (ADMIN_PREFIXES.some((p) => pathname.startsWith(p)) && !isAdmin) {
    return unauthorized(isApi, req, 403);
  }

  // Per-feature authorization (admins bypass).
  if (!isAdmin) {
    const feature = requiredFeature(pathname, req.method);
    if (feature && !session.perms.includes(feature)) {
      return unauthorized(isApi, req, 403);
    }
  }

  // Establish the trusted data-tenant for downstream route handlers. A client is
  // always pinned to its own tenant. An admin may act as a specific client by
  // setting the `ivr_admin_client` cookie (honored only because the session is
  // verified admin — the browser sends it on every request, so all the admin's
  // data fetches transparently scope to the selected client). With none set,
  // admin is tenant-less (used for /api/admin management endpoints).
  //
  // The legacy "__main__" sentinel (pre-tenancy "main account") is retired: that
  // data is now the real client "Pryank". A lingering "__main__" cookie is used
  // as-is — i.e. it resolves to an isolated, empty "__main__" tenant, NOT the
  // shared un-prefixed scope — so a stale session can never read Pryank's data
  // nor write back into the tenant-less scope and re-orphan data. The frontend
  // clears the stale cookie on load so the admin returns to normal.
  const adminViewClient = isAdmin ? req.cookies.get("ivr_admin_client")?.value || "" : "";
  const effectiveClient = isAdmin ? adminViewClient : session.cid;

  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete("x-ivr-client");
  if (effectiveClient) requestHeaders.set("x-ivr-client", effectiveClient);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
