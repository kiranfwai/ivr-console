import { query } from "./db";
import { getConfig, getOrder } from "./cashfree";
import { creditOrderPaid } from "./wallet";

/**
 * Safety net for wallet top-ups.
 *
 * A payment normally reaches the wallet one of two ways: Cashfree's webhook, or
 * the customer's browser returning to the billing page (which verifies the
 * order). On 13 Nov 2026 a ₹10,000 payment was taken and NEITHER arrived, so the
 * money sat at Cashfree until someone credited it by hand.
 *
 * Every few minutes this asks Cashfree about recent orders we still think are
 * unpaid, and credits the ones Cashfree says are PAID. `creditOrderPaid` is
 * idempotent on the order id, so a late webhook, a verify and this sweep can
 * never credit the same order twice. Orders Cashfree reports as finished
 * without payment are marked 'failed' so they stop being asked about.
 */

const INTERVAL_MS = Number(process.env.CASHFREE_RECONCILE_MS) || 3 * 60_000;
// Give the webhook / return path a head start; look back far enough to catch a
// payment that failed to land overnight.
const MIN_AGE = "2 minutes";
const MAX_AGE = "3 days";
const PER_SWEEP = 25;

const G = globalThis as any;

export async function reconcileOnce(): Promise<{ checked: number; credited: number; closed: number }> {
  const cfg = await getConfig();
  if (!cfg.appId || !cfg.secretKey) return { checked: 0, credited: 0, closed: 0 };

  const { rows } = await query<{ order_id: string }>(
    `SELECT order_id FROM wallet_order
      WHERE status = 'created'
        AND created_at < now() - interval '${MIN_AGE}'
        AND created_at > now() - interval '${MAX_AGE}'
      ORDER BY created_at
      LIMIT ${PER_SWEEP}`,
  );
  let credited = 0, closed = 0;
  for (const { order_id } of rows) {
    try {
      const st = await getOrder(order_id);
      if (st.paid) {
        // Someone may already have added this money by hand (as on 13 Nov). A
        // hand-added top-up of the same amount, after the order, with no order
        // id on it, IS this payment: link it so the credit below is a no-op and
        // the order still gets marked paid and invoiced. A hand-added
        // 'adjustment' can't be linked safely — leave that for a person.
        const { rows: manual } = await query<{ id: string; type: string }>(
          `SELECT t.id, t.type FROM wallet_txn t JOIN wallet_order o ON o.order_id = $1
            WHERE t.client_id = o.client_id AND t.amount = o.amount AND t.ref IS NULL
              AND t.type IN ('topup','adjustment') AND t.created_at > o.created_at
            ORDER BY t.id LIMIT 1`,
          [order_id],
        );
        if (manual.length && manual[0].type === "adjustment") {
          console.warn(`[cashfree reconcile] ${order_id} is PAID and a matching manual adjustment exists (txn ${manual[0].id}) — not crediting; needs a person`);
          continue;
        }
        if (manual.length) {
          await query(`UPDATE wallet_txn SET ref=$1, description = description || ' · Cashfree ' || $1 WHERE id=$2 AND ref IS NULL`, [order_id, manual[0].id]);
          console.warn(`[cashfree reconcile] ${order_id} matched hand-added top-up txn ${manual[0].id} — linked, not credited again`);
        }
        const r = await creditOrderPaid(order_id);
        if (r.credited) {
          credited++;
          console.warn(`[cashfree reconcile] ${order_id} was PAID at Cashfree but not credited — credited now`);
        }
      } else if (st.status === "EXPIRED" || st.status === "TERMINATED") {
        await query(`UPDATE wallet_order SET status='failed' WHERE order_id=$1 AND status='created'`, [order_id]);
        closed++;
      }
    } catch (e: any) {
      // An order Cashfree doesn't know (old sandbox order) or a network blip:
      // leave it for the next sweep; it ages out after MAX_AGE.
      console.error(`[cashfree reconcile] ${order_id}:`, e?.message || e);
    }
  }
  return { checked: rows.length, credited, closed };
}

export async function startCashfreeReconciler(): Promise<void> {
  if (G.__ivrCashfreeReconciler) return;
  G.__ivrCashfreeReconciler = true;
  const tick = async () => {
    if (G.__ivrCashfreeReconciling) return; // never overlap sweeps
    G.__ivrCashfreeReconciling = true;
    try {
      const r = await reconcileOnce();
      if (r.credited || r.closed) console.info(`[cashfree reconcile] checked ${r.checked}, credited ${r.credited}, closed ${r.closed}`);
    } catch (e) {
      console.error("[cashfree reconcile] sweep failed:", e);
    } finally {
      G.__ivrCashfreeReconciling = false;
    }
  };
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVAL_MS);
  console.info(`[cashfree reconcile] started — every ${Math.round(INTERVAL_MS / 1000)}s`);
}
