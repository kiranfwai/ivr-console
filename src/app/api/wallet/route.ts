import { NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getBalance } from "@/lib/wallet";
import { getGlobalPricing, getConnectedCallRate } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Gated to the `billing` perm in middleware. Returns the current client's wallet
// balance + the per-connected-call rate (so the UI can warn when the balance is
// too low to dial). The client is pinned via the trusted x-ivr-client header.
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) {
    // Admin with no client selected has no wallet of its own.
    return NextResponse.json({ balance: 0, currency: "INR", rate: 0, noClient: true });
  }
  const [balance, pricing, rate] = await Promise.all([
    getBalance(clientId),
    getGlobalPricing(),
    getConnectedCallRate(clientId),
  ]);
  return NextResponse.json({ balance, currency: pricing.currency, rate });
}
