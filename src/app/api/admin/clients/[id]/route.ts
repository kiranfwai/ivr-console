import { NextRequest, NextResponse } from "next/server";
import { updateClient, deleteClient } from "@/lib/clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only (enforced in middleware): edit perms / rename / reset password /
// activate-deactivate, or delete a client login.

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const patch: {
    name?: string;
    perms?: unknown;
    active?: boolean;
    password?: string;
    perCall?: number | null;
    perMinute?: number | null;
    perConnectedCall?: number | null;
  } = {};

  if (typeof body.name === "string") patch.name = body.name;
  if (body.perms !== undefined) patch.perms = body.perms;
  if (typeof body.active === "boolean") patch.active = body.active;
  // Cost overrides: number sets an override, null clears it (back to global default).
  if (body.perCall !== undefined) patch.perCall = body.perCall === null ? null : Number(body.perCall);
  if (body.perMinute !== undefined) patch.perMinute = body.perMinute === null ? null : Number(body.perMinute);
  if (body.perConnectedCall !== undefined)
    patch.perConnectedCall = body.perConnectedCall === null ? null : Number(body.perConnectedCall);
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: "password must be at least 6 characters" }, { status: 400 });
    }
    patch.password = body.password;
  }

  const client = await updateClient(params.id, patch);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ client });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteClient(params.id);
  return NextResponse.json({ ok: true });
}
