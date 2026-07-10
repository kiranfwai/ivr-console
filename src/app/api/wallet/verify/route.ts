import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getOrder } from "@/lib/cashfree";
import { getOrderRecord, creditOrderPaid, getBalance } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Confirm a top-up after the client returns from Cashfree checkout. This is the
 * belt-and-braces path alongside the webhook: we ask Cashfree for the order
 * status and, if PAID, credit the wallet (idempotent — the webhook may have
 * already done it). Only the order's owning client may verify it.
 */
export async function GET(req: NextRequest) {
  const clientId = currentClientId();
  const orderId = new URL(req.url).searchParams.get("order_id") || "";
  if (!orderId) return NextResponse.json({ error: "order_id required" }, { status: 400 });

  const record = await getOrderRecord(orderId);
  if (!record || (clientId && record.clientId !== clientId)) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  try {
    const status = await getOrder(orderId);
    if (status.paid) {
      const { balance } = await creditOrderPaid(orderId);
      return NextResponse.json({ paid: true, balance, amount: record.amount });
    }
    return NextResponse.json({ paid: false, status: status.status, balance: await getBalance(record.clientId) });
  } catch (e: any) {
    console.error("[wallet/verify] failed:", e);
    return NextResponse.json({ error: "could not verify payment" }, { status: 502 });
  }
}
