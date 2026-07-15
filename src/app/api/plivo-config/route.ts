import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { testPlivoCreds } from "@/lib/plivo";
import {
  getClientPlivoConfigPublic,
  saveClientPlivoConfig,
  setClientFromNumber,
  clearClientPlivoConfig,
} from "@/lib/plivo-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The current client's Plivo account connection. Tenant-scoped by middleware:
 * a client manages their OWN account; an admin "viewing as" a client manages
 * that client's. The raw Auth Token is never returned (only a masked view).
 *
 *   GET                                   → { connected, authId, tokenMasked, fromNumber }
 *   POST   { authId, authToken, fromNumber? } → validate creds against Plivo, then connect
 *   PATCH  { fromNumber }                 → set the default caller-ID number only
 *   DELETE                                → disconnect (back to the shared account)
 */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ connected: false, authId: "", tokenMasked: "", fromNumber: "" });
  return NextResponse.json(await getClientPlivoConfigPublic(clientId));
}

export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "no client in scope" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const authId = typeof body?.authId === "string" ? body.authId.trim() : "";
  const authToken = typeof body?.authToken === "string" ? body.authToken.trim() : "";
  const fromNumber = typeof body?.fromNumber === "string" ? body.fromNumber.trim() : "";
  if (!authId || !authToken) {
    return NextResponse.json({ error: "Auth ID and Auth Token are both required." }, { status: 400 });
  }

  // Validate the creds against Plivo before saving, so we never store a bad pair.
  const test = await testPlivoCreds(authId, authToken);
  if (!test.ok) {
    const msg =
      test.status === 401
        ? "Plivo rejected these credentials (401). Check the Auth ID and Auth Token."
        : test.status === 0
          ? "Couldn't reach Plivo to verify. Check your connection and try again."
          : `Plivo returned HTTP ${test.status} verifying these credentials.`;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  await saveClientPlivoConfig(clientId, { authId, authToken, fromNumber });
  return NextResponse.json({ ok: true, ...(await getClientPlivoConfigPublic(clientId)) });
}

export async function PATCH(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "no client in scope" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const fromNumber = typeof body?.fromNumber === "string" ? body.fromNumber : "";
  await setClientFromNumber(clientId, fromNumber);
  return NextResponse.json({ ok: true, ...(await getClientPlivoConfigPublic(clientId)) });
}

export async function DELETE() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "no client in scope" }, { status: 400 });
  await clearClientPlivoConfig(clientId);
  return NextResponse.json({ ok: true });
}
