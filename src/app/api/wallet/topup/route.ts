import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { currentClientId } from "@/lib/tenant";
import { getClient } from "@/lib/clients";
import { createOrder, getConfigPublic } from "@/lib/cashfree";
import { createOrderRecord } from "@/lib/wallet";
import { publicBaseUrl } from "@/lib/plivo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_TOPUP = 1;
const MAX_TOPUP = 100_000;

/**
 * Start a wallet top-up: create a Cashfree order for the current client and
 * return the payment_session_id the browser checks out with. The wallet is only
 * credited later, when the webhook (or the return-verify) confirms payment.
 */
export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "no client in context" }, { status: 400 });

  const cfg = await getConfigPublic();
  if (!cfg.configured) {
    return NextResponse.json({ error: "Payments are not configured yet. Contact the administrator." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const amount = Math.round((Number(body?.amount) || 0) * 100) / 100;
  if (!(amount >= MIN_TOPUP) || amount > MAX_TOPUP) {
    return NextResponse.json({ error: `Amount must be between ₹${MIN_TOPUP} and ₹${MAX_TOPUP}.` }, { status: 400 });
  }

  const client = await getClient(clientId);
  const orderId = `wal_${randomUUID().replace(/-/g, "")}`;
  const base = publicBaseUrl(req);

  try {
    const order = await createOrder({
      orderId,
      amount,
      customer: {
        id: clientId,
        email: client?.email || undefined,
        name: client?.name || undefined,
      },
      returnUrl: `${base}/?tab=billing&cf_order={order_id}`,
      notifyUrl: `${base}/api/wallet/cashfree/webhook`,
    });
    // Record BEFORE returning so the webhook can always resolve order → client.
    await createOrderRecord(order.orderId, clientId, amount);
    return NextResponse.json({
      orderId: order.orderId,
      paymentSessionId: order.paymentSessionId,
      env: order.env,
    });
  } catch (e: any) {
    console.error("[wallet/topup] create order failed:", e);
    const msg = String(e?.message || e);
    return NextResponse.json(
      { error: msg === "cashfree_not_configured" ? "Payments are not configured yet." : "Could not start payment. Try again." },
      { status: 502 },
    );
  }
}
