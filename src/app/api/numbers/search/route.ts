import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { searchNumbersForClient } from "@/lib/numbers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Search Plivo numbers this client can buy, on their OWN connected account.
 * Tenant-scoped. `connected:false` → the client hasn't connected an account.
 *
 *   GET ?country=IN&type=fixed&pattern=98 → { connected, numbers }
 */
export async function GET(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ connected: false, numbers: [] });

  const u = new URL(req.url);
  const countryIso = (u.searchParams.get("country") || "IN").toUpperCase().slice(0, 2);
  const type = u.searchParams.get("type") || undefined;
  const pattern = u.searchParams.get("pattern") || undefined;

  try {
    const r = await searchNumbersForClient(clientId, { countryIso, type: type || undefined, pattern: pattern || undefined });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || "Search failed") }, { status: 502 });
  }
}
