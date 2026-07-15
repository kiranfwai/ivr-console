import { redis } from "./redis";
import { normalizePhone } from "./phone";

/**
 * Per-client Do-Not-Disturb (DND) list.
 *
 * A tenant-scoped set of phone numbers this client must never call. Because the
 * key `dnd` is passed through `scopeKey()` (see tenant.ts / redis.ts), every
 * client's DND list is stored separately (`t:<clientId>:dnd`) and read back only
 * within that client's request/worker scope — exactly like campaigns, calls and
 * bulk jobs. No client can see or affect another client's list.
 *
 * Numbers are stored in the SAME normalized E.164 form the dialer uses
 * (`normalizePhone`), so an on-DND check is a straight membership test against
 * the number we're about to dial — regardless of how it was typed on either side
 * (spaces, leading 0, missing country code, etc.).
 *
 * Every outbound dial path funnels the number through `isDnd()` before placing
 * the call: the single test call and external trigger (place-campaign-call.ts)
 * and the bulk worker (bulk-runner.ts). A match means the call is skipped, not
 * failed — nothing is dialed and no wallet charge is incurred.
 */

const DND_KEY = "dnd";

/** Normalize a raw phone into the canonical dial form used for storage + matching. */
export function dndKeyFor(raw: string): string {
  return normalizePhone(String(raw || ""));
}

/** True if `phone` is on the current client's DND list. */
export async function isDnd(phone: string): Promise<boolean> {
  const num = dndKeyFor(phone);
  if (!num) return false;
  return redis().sismember(DND_KEY, num);
}

/**
 * Add one or more numbers to the DND list. Accepts raw strings (any format);
 * each is normalized before storage and blanks are dropped. Returns how many
 * were newly added and the resulting total.
 */
export async function addDnd(rawPhones: string[]): Promise<{ added: number; total: number }> {
  const nums = Array.from(
    new Set(rawPhones.map(dndKeyFor).filter((n) => n.length > 0)),
  );
  let added = 0;
  if (nums.length) added = await redis().sadd(DND_KEY, ...nums);
  const total = await redis().scard(DND_KEY);
  return { added, total };
}

/** Remove one or more numbers from the DND list. Returns how many were removed. */
export async function removeDnd(rawPhones: string[]): Promise<{ removed: number; total: number }> {
  const nums = Array.from(
    new Set(rawPhones.map(dndKeyFor).filter((n) => n.length > 0)),
  );
  let removed = 0;
  if (nums.length) removed = await redis().srem(DND_KEY, ...nums);
  const total = await redis().scard(DND_KEY);
  return { removed, total };
}

/** Count of numbers on the current client's DND list. */
export function dndCount(): Promise<number> {
  return redis().scard(DND_KEY);
}

/** All numbers on the current client's DND list, sorted for stable display. */
export async function listDnd(): Promise<string[]> {
  const nums = await redis().smembers(DND_KEY);
  return nums.sort();
}
