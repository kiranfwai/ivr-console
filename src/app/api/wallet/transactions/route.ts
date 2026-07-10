import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { listTxns } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The current client's wallet ledger (newest first). Optional ?from=&to= (ISO),
// ?limit=&offset= for paging.
export async function GET(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ transactions: [] });

  const u = new URL(req.url);
  const limit = Number(u.searchParams.get("limit")) || 100;
  const offset = Number(u.searchParams.get("offset")) || 0;
  const from = u.searchParams.get("from") || undefined;
  const to = u.searchParams.get("to") || undefined;

  const transactions = await listTxns(clientId, { limit, offset, from, to });
  return NextResponse.json({ transactions });
}
