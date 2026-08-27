import type { Metadata } from "next";
import { cookies } from "next/headers";
import { verifySessionCookie, SESSION_COOKIE } from "@/lib/auth";
import Console from "@/components/Console";
import Landing from "@/components/landing/Landing";

// The session is read per request, so this route can never be statically cached.
export const dynamic = "force-dynamic";

// The root is the only public page, so it is also the only one crawlers may index.
// Everything else stays behind `robots: { index: false }` from the root layout.
export const metadata: Metadata = {
  title: "IVR Console — turn a Google Sheet into thousands of calls",
  description:
    "Connect a Google Sheet and IVR Console dials the list, captures press-1 interest, " +
    "sends WhatsApp the moment someone answers, and hands you a per-sheet report.",
  robots: { index: true, follow: true },
};

/**
 * One route, two faces.
 *
 *  - Signed out → the public landing page.
 *  - Signed in  → the console, exactly as before.
 *
 * `/` is allowed through the middleware unauthenticated (see PUBLIC_EXACT there),
 * so the session check has to happen here rather than being taken for granted.
 */
export default async function Root() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookie(token);

  return session ? <Console /> : <Landing />;
}
