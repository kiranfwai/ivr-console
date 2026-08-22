import { query, withTx } from "./db";
import { getConnectedCallRate } from "./pricing";
import { issueInvoiceForOrder } from "./invoice";

/**
 * Per-client prepaid wallet (real ₹).
 *
 * A client tops up (via Cashfree) and every CONNECTED call debits a flat rate
 * (see pricing.ts `perConnectedCall`). Balance + ledger live in `client_wallet`
 * / `wallet_txn`, keyed by client id (NOT tenant-partitioned — these are the
 * admin-managed mapping tables).
 *
 * All mutations go through `postTxn`, which is transactional (row-locks the
 * wallet) and idempotent on `ref`: the same call id or Cashfree order id can be
 * delivered twice (Plivo/Cashfree both retry) without double-counting.
 *
 * Node runtime only (hits Postgres).
 */

export type WalletTxnType = "topup" | "charge" | "adjustment" | "refund";

export interface WalletTxn {
  id: number;
  type: WalletTxnType;
  amount: number;       // signed ₹: +credit, -charge
  balanceAfter: number;
  description: string;
  ref: string | null;
  createdAt: string;    // ISO
}

interface TxnRow {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string;
  ref: string | null;
  created_at: Date | string;
}

function toTxn(r: TxnRow): WalletTxn {
  return {
    id: Number(r.id),
    type: r.type as WalletTxnType,
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    description: r.description || "",
    ref: r.ref ?? null,
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
  };
}

/** Current balance for a client (0 if the wallet has never been touched). */
export async function getBalance(clientId: string): Promise<number> {
  if (!clientId) return 0;
  const { rows } = await query<{ balance: number }>(
    `SELECT balance FROM client_wallet WHERE client_id=$1`,
    [clientId],
  );
  return rows.length ? Number(rows[0].balance) : 0;
}

/** Balances for many clients at once (missing = 0). Used by admin views. */
export async function getBalances(clientIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!clientIds.length) return out;
  const { rows } = await query<{ client_id: string; balance: number }>(
    `SELECT client_id, balance FROM client_wallet WHERE client_id = ANY($1)`,
    [clientIds],
  );
  for (const r of rows) out[r.client_id] = Number(r.balance);
  return out;
}

export interface PostResult {
  balance: number;
  applied: boolean; // false when a duplicate ref was ignored
  txn: WalletTxn | null;
}

/**
 * Apply a signed amount to a client's wallet and append a ledger row, atomically.
 *
 * `ref` (when given) is unique per (client, type): a repeated post with the same
 * ref is a no-op that returns the current balance with `applied:false`. This is
 * what makes call-charge and topup-credit safe under webhook retries.
 */
export async function postTxn(input: {
  clientId: string;
  type: WalletTxnType;
  amount: number; // signed ₹
  description?: string;
  ref?: string | null;
}): Promise<PostResult> {
  const { clientId, type } = input;
  const amount = Number(input.amount) || 0;
  const description = input.description ?? "";
  const ref = input.ref ?? null;
  if (!clientId) throw new Error("wallet: clientId required");

  return withTx(async (c) => {
    // Idempotency: bail early if this ref was already posted for this type.
    if (ref) {
      const dup = await c.query(
        `SELECT 1 FROM wallet_txn WHERE client_id=$1 AND type=$2 AND ref=$3 LIMIT 1`,
        [clientId, type, ref],
      );
      if (dup.rowCount) {
        const bal = await c.query(`SELECT balance FROM client_wallet WHERE client_id=$1`, [clientId]);
        return { balance: bal.rows.length ? Number(bal.rows[0].balance) : 0, applied: false, txn: null };
      }
    }

    // Lock (and lazily create) the wallet row so concurrent charges serialize.
    await c.query(
      `INSERT INTO client_wallet (client_id, balance) VALUES ($1, 0)
       ON CONFLICT (client_id) DO NOTHING`,
      [clientId],
    );
    const locked = await c.query<{ balance: number }>(
      `SELECT balance FROM client_wallet WHERE client_id=$1 FOR UPDATE`,
      [clientId],
    );
    const balanceBefore = locked.rows.length ? Number(locked.rows[0].balance) : 0;
    const balanceAfter = Math.round((balanceBefore + amount) * 100) / 100;

    await c.query(
      `UPDATE client_wallet SET balance=$2, updated_at=now() WHERE client_id=$1`,
      [clientId, balanceAfter],
    );
    const ins = await c.query<TxnRow>(
      `INSERT INTO wallet_txn (client_id, type, amount, balance_after, description, ref)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, type, amount, balance_after, description, ref, created_at`,
      [clientId, type, amount, balanceAfter, description, ref],
    );
    return { balance: balanceAfter, applied: true, txn: toTxn(ins.rows[0]) };
  });
}

/** Credit the wallet (topup / refund / positive adjustment). Amount must be > 0. */
export function credit(
  clientId: string,
  amount: number,
  opts?: { type?: Extract<WalletTxnType, "topup" | "refund" | "adjustment">; description?: string; ref?: string | null },
): Promise<PostResult> {
  return postTxn({
    clientId,
    type: opts?.type ?? "topup",
    amount: Math.abs(Number(amount) || 0),
    description: opts?.description,
    ref: opts?.ref ?? null,
  });
}

/**
 * Prepaid gate: may this client place a call right now? A call is allowed only
 * when the wallet can cover at least one connected call (balance >= per-call
 * rate). The admin / legacy "main" scope (empty clientId) has no wallet and is
 * never gated, and a zero rate (free tier) is never gated either.
 */
export async function canDial(
  clientId: string,
): Promise<{ ok: boolean; balance: number; rate: number }> {
  if (!clientId) return { ok: true, balance: 0, rate: 0 };
  const [balance, rate] = await Promise.all([getBalance(clientId), getConnectedCallRate(clientId)]);
  const ok = rate <= 0 || balance >= rate;
  return { ok, balance, rate };
}

/** Charge the wallet (a connected call). `amount` is the positive ₹ cost. */
export function charge(
  clientId: string,
  amount: number,
  opts?: { description?: string; ref?: string | null },
): Promise<PostResult> {
  return postTxn({
    clientId,
    type: "charge",
    amount: -Math.abs(Number(amount) || 0),
    description: opts?.description,
    ref: opts?.ref ?? null,
  });
}

/** Admin manual adjustment (signed: +credit / -debit). */
export function adjust(
  clientId: string,
  signedAmount: number,
  description: string,
): Promise<PostResult> {
  return postTxn({ clientId, type: "adjustment", amount: Number(signedAmount) || 0, description });
}

// --- Cashfree top-up orders ---------------------------------------------------

export interface WalletOrder {
  orderId: string;
  clientId: string;
  amount: number;
  status: "created" | "paid" | "failed";
  createdAt: string;
}

interface OrderRow {
  order_id: string;
  client_id: string;
  amount: number;
  status: string;
  created_at: Date | string;
}

function toOrder(r: OrderRow): WalletOrder {
  return {
    orderId: r.order_id,
    clientId: r.client_id,
    amount: Number(r.amount),
    status: (r.status as WalletOrder["status"]) || "created",
    createdAt: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
  };
}

/** Record a top-up order we just created at Cashfree (status 'created'). */
export async function createOrderRecord(orderId: string, clientId: string, amount: number): Promise<void> {
  await query(
    `INSERT INTO wallet_order (order_id, client_id, amount, status)
     VALUES ($1,$2,$3,'created')
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, clientId, Math.round(amount * 100) / 100],
  );
}

export async function getOrderRecord(orderId: string): Promise<WalletOrder | null> {
  const { rows } = await query<OrderRow>(
    `SELECT order_id, client_id, amount, status, created_at FROM wallet_order WHERE order_id=$1`,
    [orderId],
  );
  return rows.length ? toOrder(rows[0]) : null;
}

/**
 * Credit a paid top-up order into the client's wallet, exactly once.
 * Idempotent two ways: the ledger ref (order id) blocks a double credit, and we
 * flip the order to 'paid'. Safe to call from both the webhook and the return
 * verification (whichever arrives first wins; the other is a no-op).
 */
export async function creditOrderPaid(orderId: string): Promise<{ credited: boolean; balance: number }> {
  const order = await getOrderRecord(orderId);
  if (!order) throw new Error("order_not_found");
  const res = await credit(order.clientId, order.amount, {
    type: "topup",
    description: `Wallet top-up · Cashfree ${orderId}`,
    ref: orderId,
  });
  await query(
    `UPDATE wallet_order SET status='paid', paid_at=now() WHERE order_id=$1 AND status <> 'paid'`,
    [orderId],
  );
  // Issue the tax invoice for this payment. Deliberately last and deliberately
  // best-effort: it swallows its own errors, because money that has been taken
  // must stay credited even if a tax field is blank or the number series is
  // unreachable. A payment left uninvoiced can be back-filled; a payment left
  // uncredited is a support ticket and a refund.
  await issueInvoiceForOrder(orderId).catch(() => null);
  return { credited: res.applied, balance: res.balance };
}

/** Ledger rows, newest first. Optional IST-agnostic ISO date-range filter. */
export async function listTxns(
  clientId: string,
  opts?: { limit?: number; offset?: number; from?: string; to?: string; types?: string[] },
): Promise<WalletTxn[]> {
  if (!clientId) return [];
  const params: any[] = [clientId];
  let where = `client_id=$1`;
  if (opts?.from) {
    params.push(opts.from);
    where += ` AND created_at >= $${params.length}`;
  }
  if (opts?.to) {
    params.push(opts.to);
    where += ` AND created_at <= $${params.length}`;
  }
  if (opts?.types && opts.types.length) {
    params.push(opts.types);
    where += ` AND type = ANY($${params.length})`;
  }
  const limit = Math.min(Math.max(1, opts?.limit ?? 100), 5000);
  params.push(limit);
  const limitIdx = params.length;
  params.push(Math.max(0, opts?.offset ?? 0));
  const offsetIdx = params.length;

  const { rows } = await query<TxnRow>(
    `SELECT id, type, amount, balance_after, description, ref, created_at
       FROM wallet_txn WHERE ${where}
       ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  return rows.map(toTxn);
}
