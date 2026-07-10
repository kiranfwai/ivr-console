import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only (enforced in middleware): list + create client logins.

export async function GET() {
  return NextResponse.json({ clients: await listClients() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (password.length < 6) {
    return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const client = await createClient({ name, email, password, perms: body.perms });
    return NextResponse.json({ client });
  } catch (e: any) {
    if (e?.message === "email_taken") {
      return NextResponse.json({ error: "a client with that email already exists" }, { status: 409 });
    }
    throw e;
  }
}
