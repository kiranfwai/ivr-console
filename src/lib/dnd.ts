import { redis } from "./redis";
import { query } from "./db";
import { scopeKey } from "./tenant";
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

/**
 * One page of the DND list, plus the totals needed to draw a pager.
 *
 * `listDnd()` above returns the WHOLE set, which is fine for the dial-time
 * check but not for drawing the screen: a client who uploads a 50,000-number
 * scrub list would ship all 50,000 to the browser and get one DOM node each.
 * This reads only what is shown.
 *
 * Search runs over the whole list, not the visible page, and compares digits
 * only — so "88255 74083" finds "+918825574083" however either was typed.
 */
export async function pageDnd(opts: {
  offset?: number;
  limit?: number;
  q?: string;
} = {}): Promise<{ numbers: string[]; total: number; matched: number }> {
  const k = scopeKey(DND_KEY);
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 500);
  const offset = Math.max(0, opts.offset ?? 0);
  const needle = String(opts.q || "").replace(/\D+/g, "");

  const totalRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sset WHERE k=$1`,
    [k],
  );
  const total = totalRes.rows[0]?.n ?? 0;

  if (!needle) {
    const { rows } = await query<{ member: string }>(
      `SELECT member FROM sset WHERE k=$1 ORDER BY member LIMIT $2 OFFSET $3`,
      [k, limit, offset],
    );
    return { numbers: rows.map((r) => r.member), total, matched: total };
  }

  const like = `%${needle}%`;
  const matchedRes = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sset
      WHERE k=$1 AND regexp_replace(member, '[^0-9]', '', 'g') LIKE $2`,
    [k, like],
  );
  const { rows } = await query<{ member: string }>(
    `SELECT member FROM sset
      WHERE k=$1 AND regexp_replace(member, '[^0-9]', '', 'g') LIKE $2
      ORDER BY member LIMIT $3 OFFSET $4`,
    [k, like, limit, offset],
  );
  return { numbers: rows.map((r) => r.member), total, matched: matchedRes.rows[0]?.n ?? 0 };
}
