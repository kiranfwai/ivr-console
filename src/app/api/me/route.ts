import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getClient, FEATURES } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Who is logged in — drives which tabs the frontend renders. */
export async function GET() {
  const s = await readSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (s.role === "admin") {
    return NextResponse.json({
      role: "admin",
      email: process.env.ADMIN_EMAIL || "admin@local",
      perms: [...FEATURES],
    });
  }

  const client = await getClient(s.cid);
  return NextResponse.json({
    role: "client",
    clientId: s.cid,
    name: client?.name ?? null,
    email: client?.email ?? null,
    perms: s.perms,
  });
}
