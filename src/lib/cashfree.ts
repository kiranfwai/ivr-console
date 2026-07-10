import { createHmac } from "node:crypto";
import { query } from "./db";

/**
 * Cashfree Payment Gateway integration for wallet top-ups.
 *
 * One shared merchant account (the admin's) collects every client's top-up —
 * mirrors the single-Plivo-account model. Credentials + environment are stored
 * in app_config('cashfree') and entered from the admin UI, so no redeploy is
 * needed to go live. Supports both sandbox and production.
 *
 * Flow: createOrder() → client pays via Cashfree checkout (payment_session_id)
 * → Cashfree calls our webhook (and/or the client returns) → we verify and
 * credit the wallet, idempotent on the order id.
 *
 * Node runtime only.
 */

const CONFIG_KEY = "cashfree";
const API_VERSION = "2023-08-01";

export type CashfreeEnv = "sandbox" | "production";

export interface CashfreeConfig {
  env: CashfreeEnv;
  appId: string;
  secretKey: string;
}

/** Config as shown to the admin — secret is never returned, only whether it's set. */
export interface CashfreeConfigPublic {
  env: CashfreeEnv;
  appId: string;
  secretSet: boolean;
  configured: boolean; // both appId + secret present
}

function sanitizeEnv(v: unknown): CashfreeEnv {
  return v === "production" ? "production" : "sandbox";
}

export async function getConfig(): Promise<CashfreeConfig> {
  const { rows } = await query<{ v: any }>(`SELECT v FROM app_config WHERE k=$1`, [CONFIG_KEY]);
  const o = (rows.length && rows[0].v && typeof rows[0].v === "object" ? rows[0].v : {}) as Record<string, unknown>;
  return {
    env: sanitizeEnv(o.env),
    appId: typeof o.appId === "string" ? o.appId : "",
    secretKey: typeof o.secretKey === "string" ? o.secretKey : "",
  };
}

export function toPublic(c: CashfreeConfig): CashfreeConfigPublic {
  return {
    env: c.env,
    appId: c.appId,
    secretSet: !!c.secretKey,
    configured: !!c.appId && !!c.secretKey,
  };
}

export async function getConfigPublic(): Promise<CashfreeConfigPublic> {
  return toPublic(await getConfig());
}

/**
 * Persist config. `secretKey` is only overwritten when a non-empty value is
 * given, so the admin can change env / appId without re-typing the secret.
 */
export async function setConfig(input: {
  env?: unknown;
  appId?: unknown;
  secretKey?: unknown;
}): Promise<CashfreeConfigPublic> {
  const cur = await getConfig();
  const next: CashfreeConfig = {
    env: input.env === undefined ? cur.env : sanitizeEnv(input.env),
    appId: typeof input.appId === "string" ? input.appId.trim() : cur.appId,
    // Empty/omitted secret keeps the existing one; a real value replaces it.
    secretKey:
      typeof input.secretKey === "string" && input.secretKey.trim()
        ? input.secretKey.trim()
        : cur.secretKey,
  };
  await query(
    `INSERT INTO app_config (k, v) VALUES ($1, $2::jsonb)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [CONFIG_KEY, JSON.stringify(next)],
  );
  return toPublic(next);
}

function baseUrl(env: CashfreeEnv): string {
  return env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

function authHeaders(cfg: CashfreeConfig): Record<string, string> {
  return {
    "x-client-id": cfg.appId,
    "x-client-secret": cfg.secretKey,
    "x-api-version": API_VERSION,
    "content-type": "application/json",
  };
}

export interface CreateOrderInput {
  orderId: string;
  amount: number;
  customer: { id: string; phone?: string; email?: string; name?: string };
  returnUrl: string;
  notifyUrl: string;
}

export interface CreateOrderResult {
  orderId: string;
  paymentSessionId: string;
  env: CashfreeEnv;
}

/** Create a Cashfree order; returns the payment_session_id the client checks out with. */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const cfg = await getConfig();
  if (!cfg.appId || !cfg.secretKey) throw new Error("cashfree_not_configured");

  const body = {
    order_id: input.orderId,
    order_amount: Math.round(input.amount * 100) / 100,
    order_currency: "INR",
    customer_details: {
      customer_id: input.customer.id,
      // Cashfree requires a phone; fall back to a placeholder for accounts that
      // don't collect one (fine for sandbox and PG-hosted checkout).
      customer_phone: input.customer.phone || "9999999999",
      ...(input.customer.email ? { customer_email: input.customer.email } : {}),
      ...(input.customer.name ? { customer_name: input.customer.name } : {}),
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
  };

  const res = await fetch(`${baseUrl(cfg.env)}/orders`, {
    method: "POST",
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`cashfree_create_failed: ${json?.message || res.status}`);
  }
  if (!json?.payment_session_id) {
    throw new Error("cashfree_no_session");
  }
  return { orderId: json.order_id || input.orderId, paymentSessionId: json.payment_session_id, env: cfg.env };
}

export interface OrderStatus {
  orderId: string;
  status: string; // PAID | ACTIVE | EXPIRED | TERMINATED | ...
  amount: number;
  paid: boolean;
}

/** Fetch an order's current status (authoritative check before crediting). */
export async function getOrder(orderId: string): Promise<OrderStatus> {
  const cfg = await getConfig();
  if (!cfg.appId || !cfg.secretKey) throw new Error("cashfree_not_configured");
  const res = await fetch(`${baseUrl(cfg.env)}/orders/${encodeURIComponent(orderId)}`, {
    headers: authHeaders(cfg),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`cashfree_get_failed: ${json?.message || res.status}`);
  const status = String(json?.order_status || "");
  return {
    orderId: json?.order_id || orderId,
    status,
    amount: Number(json?.order_amount) || 0,
    paid: status === "PAID",
  };
}

/**
 * Verify a Cashfree webhook signature.
 * signature = base64( HMAC-SHA256( secretKey, timestamp + rawBody ) ).
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
): Promise<boolean> {
  const cfg = await getConfig();
  if (!cfg.secretKey || !signature || !timestamp) return false;
  const expected = createHmac("sha256", cfg.secretKey).update(timestamp + rawBody).digest("base64");
  // Length-safe compare.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
