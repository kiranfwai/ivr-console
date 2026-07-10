import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/cashfree";
import { creditOrderPaid } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cashfree payment webhook (public — no session; authenticity comes from the
 * signature). On a successful payment we credit the wallet, idempotent on the
 * order id so retries and the client-side verify path never double-credit.
 *
 * Always answers 200 on well-formed, verified events so Cashfree stops retrying;
 * a bad signature gets 401.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-webhook-signature") || "";
  const timestamp = req.headers.get("x-webhook-timestamp") || "";

  const ok = await verifyWebhookSignature(raw, signature, timestamp);
  if (!ok) {
    console.warn("[cashfree webhook] bad signature");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let evt: any = {};
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // malformed but signed — ack, nothing to do
  }

  const type = evt?.type || "";
  const orderId = evt?.data?.order?.order_id || "";

  try {
    if (orderId && (type === "PAYMENT_SUCCESS_WEBHOOK" || evt?.data?.payment?.payment_status === "SUCCESS")) {
      await creditOrderPaid(orderId);
    }
  } catch (e) {
    // Log but still ack — verify-on-return will reconcile; retry storms help nobody.
    console.error("[cashfree webhook] credit failed:", e);
  }
  return NextResponse.json({ ok: true });
}
