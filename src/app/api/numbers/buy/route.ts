import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { buyNumberForClient } from "@/lib/numbers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Buy (rent) a Plivo number onto the client's OWN connected account. Costs real
 * money on that account's balance. Tenant-scoped.
 *
 *   POST { number } → { ok, message } | 400/402/502 with a message
 */
export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "no client in scope" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const number = typeof body?.number === "string" ? body.number : "";
  if (!number) return NextResponse.json({ error: "number required" }, { status: 400 });

  const r = await buyNumberForClient(clientId, number);
  if (!r.connected) {
    return NextResponse.json({ error: "Connect your own Plivo account first." }, { status: 400 });
  }
  if (!r.ok) {
    // Surface Plivo's message (e.g. KYC/compliance block for India, insufficient
    // balance, number no longer available) so the client sees why it failed.
    return NextResponse.json({ error: r.message || `Purchase failed (HTTP ${r.status})` }, { status: r.status === 402 ? 402 : 400 });
  }
  return NextResponse.json({ ok: true, message: r.message });
}
