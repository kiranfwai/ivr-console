import { AsyncLocalStorage } from "async_hooks";
import { headers } from "next/headers";

/**
 * Per-request / per-job tenant (client) context.
 *
 * Every piece of application data (campaigns, calls, stats, audios, bulk jobs)
 * is isolated per client. Rather than thread a `clientId` argument through the
 * dozens of data-layer functions, we carry it implicitly:
 *
 *   1. API route handlers get the effective client from the trusted
 *      `x-ivr-client` request header (set by middleware after it verifies the
 *      session — see middleware.ts). `currentClientId()` reads it via
 *      next/headers.
 *   2. Background work with no HTTP request (the bulk worker, Plivo webhooks
 *      that resolve their tenant from the callback URL) establishes the context
 *      explicitly with `runWithTenant(clientId, fn)` — an AsyncLocalStorage
 *      scope that wins over the header.
 *
 * `scopeKey()` (used by redis.ts) turns a bare key like `campaign:abc` into
 * `t:<clientId>:campaign:abc` whenever a client is in scope, so the whole KV /
 * zset / sset / hash API becomes tenant-partitioned with no call-site changes.
 * When there is NO client in scope (admin-level operations, process startup),
 * keys are left un-prefixed.
 */

const als = new AsyncLocalStorage<{ clientId: string }>();

/** Run `fn` with an explicit tenant. Used by the worker + Plivo webhooks. */
export function runWithTenant<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ clientId: clientId || "" }, fn);
}

/**
 * The client id currently in scope, or null.
 *
 * Precedence: an explicit AsyncLocalStorage scope (worker / webhook) first,
 * then the trusted `x-ivr-client` header on the active request. Reading the
 * header is done lazily and defensively — outside a request scope (e.g. the
 * worker tick) `headers()` throws, which we treat as "no header context".
 */
export function currentClientId(): string | null {
  const scoped = als.getStore();
  if (scoped) return scoped.clientId || null;

  try {
    // Outside a request scope (worker tick, process startup) headers() throws;
    // we treat that as "no header context" and fall through to unscoped keys.
    const v = headers().get("x-ivr-client");
    return v && v.length ? v : null;
  } catch {
    return null;
  }
}

/**
 * Prefix a bare data key with the active tenant, or return it unchanged when
 * no client is in scope. Idempotent for already-prefixed keys is NOT needed —
 * callers always pass bare keys.
 */
export function scopeKey(key: string): string {
  const cid = currentClientId();
  return cid ? `t:${cid}:${key}` : key;
}
