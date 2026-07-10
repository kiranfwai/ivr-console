import { query } from "./db";

/**
 * Call-cost pricing.
 *
 * The admin "defines call cost" as two rates:
 *   - perCall   — charged once per PLACED call (any outcome)
 *   - perMinute — charged per minute of CONNECTED (answered) talk time
 *
 * Cost(range) = placedCalls * perCall + billedMinutes * perMinute
 * where billedMinutes = ceil(connectedSeconds / 60).
 *
 * A global default lives in app_config (key 'pricing'); each client may carry an
 * override (per_call_cost / per_min_cost columns on app_client, NULL = inherit).
 * Amounts are plain numbers in the configured currency (default INR).
 *
 * Node runtime only (hits Postgres) — never import from middleware/edge.
 */

export interface Pricing {
  perCall: number;
  perMinute: number;
  perConnectedCall: number; // flat ₹ charged once per CONNECTED (answered) call — the live wallet billing model
  currency: string; // ISO-ish code used for display, e.g. "INR"
}

// perConnectedCall defaults to ₹0.81 (the agreed rate); perCall/perMinute stay 0
// (legacy analytics model, superseded by the connected-call charge).
export const DEFAULT_PRICING: Pricing = { perCall: 0, perMinute: 0, perConnectedCall: 0.81, currency: "INR" };

const CONFIG_KEY = "pricing";

function num(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 0 ? x : fallback;
}

function sanitize(input: unknown): Pricing {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    perCall: num(o.perCall, DEFAULT_PRICING.perCall),
    perMinute: num(o.perMinute, DEFAULT_PRICING.perMinute),
    // Older stored configs won't have perConnectedCall — fall back to the default rate.
    perConnectedCall: num(o.perConnectedCall, DEFAULT_PRICING.perConnectedCall),
    currency: typeof o.currency === "string" && o.currency.trim() ? o.currency.trim() : DEFAULT_PRICING.currency,
  };
}

/** The global default pricing (falls back to DEFAULT_PRICING when unset). */
export async function getGlobalPricing(): Promise<Pricing> {
  const { rows } = await query<{ v: unknown }>(`SELECT v FROM app_config WHERE k=$1`, [CONFIG_KEY]);
  return rows.length ? sanitize(rows[0].v) : { ...DEFAULT_PRICING };
}

/** Overwrite the global default pricing. Returns the stored (sanitized) value. */
export async function setGlobalPricing(input: unknown): Promise<Pricing> {
  const p = sanitize(input);
  await query(
    `INSERT INTO app_config (k, v) VALUES ($1, $2::jsonb)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [CONFIG_KEY, JSON.stringify(p)],
  );
  return p;
}

/**
 * The effective per-call / per-minute rate for a client: its override where set,
 * else the global default. Currency is always the global one.
 */
export function effectiveRates(
  global: Pricing,
  override: { perCall?: number | null; perMinute?: number | null },
): { perCall: number; perMinute: number } {
  return {
    perCall: override.perCall == null ? global.perCall : override.perCall,
    perMinute: override.perMinute == null ? global.perMinute : override.perMinute,
  };
}

/** Cost of `calls` placed calls totalling `connectedSeconds` of talk time. */
export function computeCost(
  calls: number,
  connectedSeconds: number,
  rates: { perCall: number; perMinute: number },
): number {
  const minutes = Math.ceil(Math.max(0, connectedSeconds) / 60);
  const cost = calls * rates.perCall + minutes * rates.perMinute;
  // Round to 2 dp to avoid float dust in totals.
  return Math.round(cost * 100) / 100;
}

/**
 * The flat ₹ charge for one CONNECTED call, for a specific client: the client's
 * `per_conn_call_cost` override where set, else the global default. This is the
 * amount debited from the wallet per answered call. Reads one row + the global
 * config; call it from the hangup path (already in the client's tenant scope,
 * but pass the client id explicitly since the wallet tables aren't partitioned).
 */
export async function getConnectedCallRate(clientId: string): Promise<number> {
  const global = await getGlobalPricing();
  if (!clientId) return global.perConnectedCall;
  const { rows } = await query<{ per_conn_call_cost: number | null }>(
    `SELECT per_conn_call_cost FROM app_client WHERE id=$1`,
    [clientId],
  );
  const override = rows.length ? rows[0].per_conn_call_cost : null;
  return override == null ? global.perConnectedCall : num(override, global.perConnectedCall);
}
