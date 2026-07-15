import { query } from "./db";

/**
 * Per-client Plivo account resolution.
 *
 * A client may connect their OWN Plivo account (Auth ID + Auth Token + a default
 * caller-ID number). When they have, their number listing AND their outbound
 * calls run through those creds. When they haven't, everything falls back to the
 * shared account configured in the environment (PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN
 * / PLIVO_FROM_NUMBER) — so any client that hasn't connected is byte-for-byte
 * unchanged from today.
 *
 * Tokens are stored as-is in the DB (same posture as the Cashfree secret in
 * app_config). Never return the raw token to the browser — use the *Public shape.
 */

export interface PlivoCreds {
  authId: string;
  authToken: string;
  fromNumber: string;
  /** "client" = the client's own connected account; "shared" = the env fallback. */
  source: "client" | "shared";
}

const ENV_AUTH_ID = () => process.env.PLIVO_AUTH_ID || "";
const ENV_AUTH_TOKEN = () => process.env.PLIVO_AUTH_TOKEN || "";
const ENV_FROM = () => process.env.PLIVO_FROM_NUMBER || "";

/**
 * Resolve the Plivo creds the given client should dial / list numbers with.
 * Returns the client's own account when connected, else the shared env account.
 * A blank/absent clientId (admin, no-tenant) always resolves to shared.
 */
export async function getClientPlivoCreds(clientId: string | null | undefined): Promise<PlivoCreds> {
  if (clientId) {
    const { rows } = await query<{
      plivo_auth_id: string | null;
      plivo_auth_token: string | null;
      plivo_from_number: string | null;
    }>(
      `SELECT plivo_auth_id, plivo_auth_token, plivo_from_number FROM app_client WHERE id=$1`,
      [clientId],
    );
    const r = rows[0];
    if (r?.plivo_auth_id && r?.plivo_auth_token) {
      return {
        authId: r.plivo_auth_id,
        authToken: r.plivo_auth_token,
        fromNumber: r.plivo_from_number || "",
        source: "client",
      };
    }
  }
  return {
    authId: ENV_AUTH_ID(),
    authToken: ENV_AUTH_TOKEN(),
    fromNumber: ENV_FROM(),
    source: "shared",
  };
}

/** Whether this client has connected their own Plivo account. */
export async function isClientPlivoConnected(clientId: string): Promise<boolean> {
  if (!clientId) return false;
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM app_client
       WHERE id=$1 AND plivo_auth_id IS NOT NULL AND plivo_auth_token IS NOT NULL`,
    [clientId],
  );
  return (rows[0]?.n ?? 0) > 0;
}

export interface PlivoConfigPublic {
  connected: boolean;
  authId: string;        // safe to show (it's the account id, not the secret)
  tokenMasked: string;   // e.g. "••••••1234" — never the raw token
  fromNumber: string;
}

/** Public (token-masked) view of a client's Plivo config, for the settings UI. */
export async function getClientPlivoConfigPublic(clientId: string): Promise<PlivoConfigPublic> {
  const empty: PlivoConfigPublic = { connected: false, authId: "", tokenMasked: "", fromNumber: "" };
  if (!clientId) return empty;
  const { rows } = await query<{
    plivo_auth_id: string | null;
    plivo_auth_token: string | null;
    plivo_from_number: string | null;
  }>(
    `SELECT plivo_auth_id, plivo_auth_token, plivo_from_number FROM app_client WHERE id=$1`,
    [clientId],
  );
  const r = rows[0];
  if (!r?.plivo_auth_id || !r?.plivo_auth_token) return empty;
  const tok = r.plivo_auth_token;
  const tokenMasked = tok.length > 4 ? `${"•".repeat(6)}${tok.slice(-4)}` : "••••";
  return {
    connected: true,
    authId: r.plivo_auth_id,
    tokenMasked,
    fromNumber: r.plivo_from_number || "",
  };
}

/** Save a client's Plivo creds. Empty authId/token clears the connection. */
export async function saveClientPlivoConfig(
  clientId: string,
  input: { authId?: string; authToken?: string; fromNumber?: string },
): Promise<void> {
  if (!clientId) return;
  const authId = (input.authId ?? "").trim() || null;
  const authToken = (input.authToken ?? "").trim() || null;
  const fromNumber = (input.fromNumber ?? "").trim() || null;
  await query(
    `UPDATE app_client SET plivo_auth_id=$2, plivo_auth_token=$3, plivo_from_number=$4 WHERE id=$1`,
    [clientId, authId, authToken, fromNumber],
  );
}

/** Update only the default caller-ID number (leave the creds as-is). */
export async function setClientFromNumber(clientId: string, fromNumber: string): Promise<void> {
  if (!clientId) return;
  await query(`UPDATE app_client SET plivo_from_number=$2 WHERE id=$1`, [clientId, fromNumber.trim() || null]);
}

/**
 * The Auth Token to verify a Plivo webhook signature with — the client's own
 * token when they placed the call through their account, else env. Returns
 * undefined (and does NO DB read) when signature verification is disabled, so
 * the webhook hot path is untouched unless VERIFY_PLIVO_SIG=1.
 */
export async function sigTokenForClient(clientId: string): Promise<string | undefined> {
  if (process.env.VERIFY_PLIVO_SIG !== "1") return undefined;
  return (await getClientPlivoCreds(clientId)).authToken || undefined;
}

/** Disconnect a client's Plivo account (back to the shared fallback). */
export async function clearClientPlivoConfig(clientId: string): Promise<void> {
  if (!clientId) return;
  await query(
    `UPDATE app_client SET plivo_auth_id=NULL, plivo_auth_token=NULL, plivo_from_number=NULL WHERE id=$1`,
    [clientId],
  );
}
