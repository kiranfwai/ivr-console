import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/clients";
import { getBalance, listTxns, adjust, credit } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only (enforced in middleware): inspect + manually adjust a client's wallet.

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [balance, transactions] = await Promise.all([
    getBalance(params.id),
    listTxns(params.id, { limit: 200 }),
  ]);
  return NextResponse.json({ balance, transactions });
}

/**
 * Manually move money in a client's wallet.
 *  - { amount: <signed ₹>, description } → an "adjustment" (can credit or debit)
 *  - { credit: <positive ₹>, description } → a manual top-up (e.g. cash/bank)
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim()
    : "Admin adjustment";

  if (body.credit !== undefined) {
    const amt = Number(body.credit);
    if (!(amt > 0)) return NextResponse.json({ error: "credit must be positive" }, { status: 400 });
    const res = await credit(params.id, amt, { type: "topup", description });
    return NextResponse.json({ balance: res.balance });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "amount must be a non-zero number" }, { status: 400 });
  }
  const res = await adjust(params.id, amount, description);
  return NextResponse.json({ balance: res.balance });
}
