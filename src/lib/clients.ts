import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { query } from "./db";
import { newId } from "./redis";

/**
 * Client (tenant) accounts + their logins.
 *
 * The admin is env-based (ADMIN_EMAIL / ADMIN_PASSWORD). Every other login is a
 * row in `app_client`: an email + scrypt-hashed password, plus the set of
 * feature tabs the admin has granted (`perms`). A client's id doubles as its
 * data-tenant id (see tenant.ts / redis.ts key scoping).
 *
 * Node runtime only (uses node:crypto scrypt) — never import from middleware.
 */

/** Feature tabs an admin can grant a client. Order = sidebar order. */
export const FEATURES = [
  "dial",
  "bulk",
  "campaigns",
  "audios",
  "reports",
  "whatsapp",
  "billing",
] as const;
export type Feature = (typeof FEATURES)[number];

export function sanitizePerms(input: unknown): Feature[] {
  if (!Array.isArray(input)) return [];
  const set = new Set(FEATURES as readonly string[]);
  const out: Feature[] = [];
  for (const v of input) {
    if (typeof v === "string" && set.has(v) && !out.includes(v as Feature)) {
      out.push(v as Feature);
    }
  }
  return out;
}

/** Public client shape — never carries the password hash/salt. */
export interface Client {
  id: string;
  name: string;
  email: string;
  perms: Feature[];
  active: boolean;
  createdAt: string;
  // Per-client call-cost overrides (null = inherit the global default). See pricing.ts.
  perCall: number | null;
  perMinute: number | null;
  // Flat per-connected-call rate override (the live wallet billing model).
  perConnectedCall: number | null;
}

type ClientRow = {
  id: string;
  name: string;
  email: string;
  pass_hash: string;
  pass_salt: string;
  perms: unknown;
  active: boolean;
  created_at: Date;
  per_call_cost: number | null;
  per_min_cost: number | null;
  per_conn_call_cost: number | null;
};

function toClient(r: ClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    perms: sanitizePerms(r.perms),
    active: r.active,
    createdAt: r.created_at.toISOString(),
    perCall: r.per_call_cost == null ? null : Number(r.per_call_cost),
    perMinute: r.per_min_cost == null ? null : Number(r.per_min_cost),
    perConnectedCall: r.per_conn_call_cost == null ? null : Number(r.per_conn_call_cost),
  };
}

const PUBLIC_COLS = `id, name, email, pass_hash, pass_salt, perms, active, created_at, per_call_cost, per_min_cost, per_conn_call_cost`;

// --- password hashing --------------------------------------------------------

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// --- CRUD --------------------------------------------------------------------

export async function listClients(): Promise<Client[]> {
  const { rows } = await query<ClientRow>(
    `SELECT ${PUBLIC_COLS} FROM app_client ORDER BY created_at DESC`,
  );
  return rows.map(toClient);
}

export async function getClient(id: string): Promise<Client | null> {
  const { rows } = await query<ClientRow>(`SELECT ${PUBLIC_COLS} FROM app_client WHERE id=$1`, [id]);
  return rows.length ? toClient(rows[0]) : null;
}

export interface CreateClientInput {
  name: string;
  email: string;
  password: string;
  perms?: unknown;
}

/** Create a client login. Throws "email_taken" if the email already exists. */
export async function createClient(input: CreateClientInput): Promise<Client> {
  const email = input.email.trim().toLowerCase();
  const existing = await query(`SELECT 1 FROM app_client WHERE email=$1`, [email]);
  if (existing.rows.length) throw new Error("email_taken");

  const id = newId("cli");
  const { hash, salt } = hashPassword(input.password);
  const perms = sanitizePerms(input.perms);
  const { rows } = await query<ClientRow>(
    `INSERT INTO app_client (id, name, email, pass_hash, pass_salt, perms, active)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb, true)
     RETURNING ${PUBLIC_COLS}`,
    [id, input.name.trim() || email, email, hash, salt, JSON.stringify(perms)],
  );
  return toClient(rows[0]);
}

export interface UpdateClientInput {
  name?: string;
  perms?: unknown;
  active?: boolean;
  password?: string;
  // Cost overrides: `undefined` leaves the column untouched, `null` clears it
  // (back to the global default), a number sets an override.
  perCall?: number | null;
  perMinute?: number | null;
  perConnectedCall?: number | null;
}

// Coerce a cost override to a non-negative number, or null to clear.
function coerceRate(v: number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function updateClient(id: string, patch: UpdateClientInput): Promise<Client | null> {
  const sets: string[] = [];
  const params: any[] = [];
  const push = (col: string, val: any) => {
    params.push(val);
    sets.push(`${col}=$${params.length}`);
  };

  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.perms !== undefined) push("perms", JSON.stringify(sanitizePerms(patch.perms)));
  if (patch.active !== undefined) push("active", !!patch.active);
  if (patch.perCall !== undefined) push("per_call_cost", coerceRate(patch.perCall));
  if (patch.perMinute !== undefined) push("per_min_cost", coerceRate(patch.perMinute));
  if (patch.perConnectedCall !== undefined) push("per_conn_call_cost", coerceRate(patch.perConnectedCall));
  if (patch.password) {
    const { hash, salt } = hashPassword(patch.password);
    push("pass_hash", hash);
    push("pass_salt", salt);
  }
  if (!sets.length) return getClient(id);

  // perms is jsonb — cast the placeholder explicitly.
  const setSql = sets
    .map((s) => (s.startsWith("perms=") ? s.replace(/=(\$\d+)$/, "=$1::jsonb") : s))
    .join(", ");
  params.push(id);
  const { rows } = await query<ClientRow>(
    `UPDATE app_client SET ${setSql} WHERE id=$${params.length} RETURNING ${PUBLIC_COLS}`,
    params,
  );
  return rows.length ? toClient(rows[0]) : null;
}

export async function deleteClient(id: string): Promise<void> {
  await query(`DELETE FROM app_client WHERE id=$1`, [id]);
}

/**
 * Verify an email + password against a client login. Returns the public client
 * (only when active) or null. Constant-work-ish: always runs scrypt against the
 * stored hash so a missing email and a wrong password take similar time.
 */
export async function verifyClientCredentials(
  email: string,
  password: string,
): Promise<Client | null> {
  const { rows } = await query<ClientRow>(
    `SELECT ${PUBLIC_COLS} FROM app_client WHERE email=$1`,
    [email.trim().toLowerCase()],
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (!verifyPassword(password, r.pass_hash, r.pass_salt)) return null;
  if (!r.active) return null;
  return toClient(r);
}
