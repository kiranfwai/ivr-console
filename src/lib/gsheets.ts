import { randomUUID } from "crypto";
import { query } from "./db";
import { runWithTenant } from "./tenant";
import { getCampaign } from "./campaigns";
import { placeCampaignCall } from "./place-campaign-call";
import { normalizePhone } from "./phone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single Sheet Auto-Dial connection.  Each client can have multiple of these
 * running in parallel — each with its own sheet, tab, campaign, and window.
 */
export interface GSheetConn {
  id: string;           // unique connection ID (UUID or 'legacy-<clientId>')
  clientId: string;
  sheetId: string;
  tabName: string;
  campaignId: string;
  callStartHour: number;
  callEndHour: number;
  lastRow: number;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  connName: string | null; // user-supplied display name (e.g. "August Evening Leads")
}

/** Backward-compatibility alias — existing code that imports GSheetConfig still works. */
export type GSheetConfig = GSheetConn;

export type LeadStatus = "queued" | "calling" | "called" | "failed";

export type CallOutcome =
  | "connected"   // answered and played through
  | "press1"      // answered and pressed 1
  | "busy"        // line was busy
  | "no-answer"   // rang but not picked up
  | "rejected"    // invalid/unallocated number or call rejected
  | "error"       // carrier / switch error
  | "failed";     // Plivo could not even initiate the call

export interface GSheetLead {
  id: number;
  clientId: string;
  connId: string | null;    // which connection this lead belongs to
  sheetId: string;
  rowIndex: number;
  name: string | null;
  email: string | null;
  phone: string;
  status: LeadStatus;
  callUuid: string | null;
  callOutcome: CallOutcome | null;
  hangupCause: string | null;
  durationSec: number | null;
  error: string | null;
  queuedAt: string;
  calledAt: string | null;
}

// ---------------------------------------------------------------------------
// DB row types (internal)
// ---------------------------------------------------------------------------

type ConnRow = {
  id: string;
  client_id: string;
  sheet_id: string;
  tab_name: string;
  campaign_id: string;
  call_start_hour: number;
  call_end_hour: number;
  last_row: number;
  enabled: boolean;
  last_synced_at: Date | null;
  last_error: string | null;
  created_at: Date;
  conn_name: string | null;
};

type LeadRow = {
  id: string;
  client_id: string;
  conn_id: string | null;
  sheet_id: string;
  row_index: number;
  name: string | null;
  email: string | null;
  phone: string;
  status: string;
  call_uuid: string | null;
  call_outcome: string | null;
  hangup_cause: string | null;
  duration_sec: number | null;
  error: string | null;
  queued_at: Date;
  called_at: Date | null;
};

function toConn(r: ConnRow): GSheetConn {
  return {
    id: r.id,
    clientId: r.client_id,
    sheetId: r.sheet_id,
    tabName: r.tab_name,
    campaignId: r.campaign_id,
    callStartHour: r.call_start_hour,
    callEndHour: r.call_end_hour,
    lastRow: r.last_row,
    enabled: r.enabled,
    lastSyncedAt: r.last_synced_at ? r.last_synced_at.toISOString() : null,
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    connName: r.conn_name ?? null,
  };
}

function toLead(r: LeadRow): GSheetLead {
  return {
    id: Number(r.id),
    clientId: r.client_id,
    connId: r.conn_id,
    sheetId: r.sheet_id,
    rowIndex: r.row_index,
    name: r.name,
    email: r.email,
    phone: r.phone,
    status: r.status as LeadStatus,
    callUuid: r.call_uuid,
    callOutcome: (r.call_outcome as CallOutcome) ?? null,
    hangupCause: r.hangup_cause ?? null,
    durationSec: r.duration_sec ?? null,
    error: r.error,
    queuedAt: r.queued_at.toISOString(),
    calledAt: r.called_at ? r.called_at.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Connection CRUD
// ---------------------------------------------------------------------------

export async function listGSheetConns(clientId: string): Promise<GSheetConn[]> {
  const { rows } = await query<ConnRow>(
    `SELECT * FROM gsheet_conn WHERE client_id = $1 ORDER BY created_at ASC`,
    [clientId],
  );
  return rows.map(toConn);
}

export async function getGSheetConn(connId: string): Promise<GSheetConn | null> {
  const { rows } = await query<ConnRow>(
    `SELECT * FROM gsheet_conn WHERE id = $1`,
    [connId],
  );
  return rows.length ? toConn(rows[0]) : null;
}

/** Backward-compat: return the first (oldest) connection for this client, or null. */
export async function getGSheetConfig(clientId: string): Promise<GSheetConn | null> {
  const conns = await listGSheetConns(clientId);
  return conns.length ? conns[0] : null;
}

export interface SaveGSheetConnInput {
  sheetId: string;
  tabName?: string;
  campaignId: string;
  callStartHour?: number;
  callEndHour?: number;
  connName?: string | null; // optional display name for the connection
}

export async function createGSheetConn(
  clientId: string,
  input: SaveGSheetConnInput,
): Promise<GSheetConn> {
  const id = randomUUID();
  const tabName = input.tabName?.trim() || "Sheet1";
  const callStartHour = input.callStartHour ?? 9;
  const callEndHour = input.callEndHour ?? 21;
  const connName = input.connName?.trim() || null;
  const { rows } = await query<ConnRow>(
    `INSERT INTO gsheet_conn (id, client_id, sheet_id, tab_name, campaign_id, call_start_hour, call_end_hour, conn_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, clientId, input.sheetId, tabName, input.campaignId, callStartHour, callEndHour, connName],
  );
  return toConn(rows[0]);
}

export async function updateGSheetConn(
  clientId: string,
  connId: string,
  input: SaveGSheetConnInput,
): Promise<GSheetConn> {
  const tabName = input.tabName?.trim() || "Sheet1";
  const callStartHour = input.callStartHour ?? 9;
  const callEndHour = input.callEndHour ?? 21;
  const connName = input.connName?.trim() || null;
  const { rows } = await query<ConnRow>(
    `UPDATE gsheet_conn
     SET sheet_id = $3, tab_name = $4, campaign_id = $5,
         call_start_hour = $6, call_end_hour = $7,
         conn_name = $8, enabled = true, last_error = NULL
     WHERE client_id = $1 AND id = $2
     RETURNING *`,
    [clientId, connId, input.sheetId, tabName, input.campaignId, callStartHour, callEndHour, connName],
  );
  if (!rows.length) throw new Error("Connection not found");
  return toConn(rows[0]);
}

export async function deleteGSheetConn(clientId: string, connId: string): Promise<void> {
  await query(`DELETE FROM gsheet_conn WHERE client_id = $1 AND id = $2`, [clientId, connId]);
  await query(`DELETE FROM gsheet_lead WHERE client_id = $1 AND conn_id = $2`, [clientId, connId]);
}

export async function setGSheetConnEnabled(
  clientId: string,
  connId: string,
  enabled: boolean,
): Promise<void> {
  await query(
    `UPDATE gsheet_conn SET enabled = $3 WHERE client_id = $1 AND id = $2`,
    [clientId, connId, enabled],
  );
}

// ---------------------------------------------------------------------------
// Backward-compat wrappers (used by the old single-connection API route)
// ---------------------------------------------------------------------------

/** @deprecated Use createGSheetConn / updateGSheetConn instead. */
export async function saveGSheetConfig(
  clientId: string,
  input: SaveGSheetConnInput,
  connId?: string,
): Promise<GSheetConn> {
  if (connId) return updateGSheetConn(clientId, connId, input);
  return createGSheetConn(clientId, input);
}

/** @deprecated Deletes ALL connections for this client. */
export async function deleteGSheetConfig(clientId: string): Promise<void> {
  await query(`DELETE FROM gsheet_conn WHERE client_id = $1`, [clientId]);
  await query(`DELETE FROM gsheet_lead WHERE client_id = $1`, [clientId]);
}

/** @deprecated Toggles ALL connections for this client. */
export async function setGSheetEnabled(clientId: string, enabled: boolean): Promise<void> {
  await query(`UPDATE gsheet_conn SET enabled = $2 WHERE client_id = $1`, [clientId, enabled]);
}

// ---------------------------------------------------------------------------
// Leads CRUD
// ---------------------------------------------------------------------------

export async function listLeads(
  clientId: string,
  connId?: string,
  limit = 300,
): Promise<GSheetLead[]> {
  if (connId) {
    const { rows } = await query<LeadRow>(
      `SELECT * FROM gsheet_lead WHERE client_id = $1 AND conn_id = $2 AND deleted_at IS NULL
       ORDER BY queued_at DESC LIMIT $3`,
      [clientId, connId, limit],
    );
    return rows.map(toLead);
  }
  const { rows } = await query<LeadRow>(
    `SELECT * FROM gsheet_lead WHERE client_id = $1 AND deleted_at IS NULL
     ORDER BY queued_at DESC LIMIT $2`,
    [clientId, limit],
  );
  return rows.map(toLead);
}

/**
 * Remove a lead from the queue the user sees.
 *
 * Soft delete, deliberately: leads are de-duplicated by phone against the rows
 * in this table, so a hard DELETE would make that number look brand new on the
 * very next poll and call the person again. The row stays as a tombstone.
 */
export async function deleteLead(clientId: string, id: number): Promise<void> {
  await query(
    `UPDATE gsheet_lead SET deleted_at = now()
     WHERE client_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [clientId, id],
  );
}

/** Empty the visible queue. Soft delete, for the reason given on deleteLead. */
export async function clearLeads(clientId: string, connId?: string): Promise<void> {
  if (connId) {
    await query(
      `UPDATE gsheet_lead SET deleted_at = now()
       WHERE client_id = $1 AND conn_id = $2 AND deleted_at IS NULL`,
      [clientId, connId],
    );
    return;
  }
  await query(
    `UPDATE gsheet_lead SET deleted_at = now() WHERE client_id = $1 AND deleted_at IS NULL`,
    [clientId],
  );
}

// ---------------------------------------------------------------------------
// Sheet fetch (no API key — uses public CSV export)
// ---------------------------------------------------------------------------

/** Extract sheet ID from a Google Sheets URL, or return the value as-is if already an ID. */
export function extractSheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : urlOrId.trim();
}

/**
 * Where the CSV export is fetched from. Always Google in production; overridable
 * so the dedupe/poll logic can be exercised against a local fixture server
 * without hitting the network. Never set this in a deployed environment.
 */
const CSV_BASE = process.env.GSHEETS_CSV_BASE || "https://docs.google.com";

/** Fetch all rows from a publicly-shared Google Sheet as a 2-D string array. */
async function fetchSheetRows(sheetId: string, tabName: string): Promise<string[][]> {
  const url =
    `${CSV_BASE}/spreadsheets/d/${encodeURIComponent(sheetId)}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Google Sheets returned HTTP ${res.status}`);
    return parseCsv(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal CSV parser — handles quoted fields containing commas and newlines. */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuote) {
      if (ch === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        cur.push(field); field = "";
      } else if (ch === '\n') {
        cur.push(field); field = "";
        if (cur.some((c) => c.trim())) rows.push(cur);
        cur = [];
      } else if (ch !== '\r') {
        field += ch;
      }
    }
  }
  if (field || cur.length) { cur.push(field); if (cur.some((c) => c.trim())) rows.push(cur); }
  return rows;
}

/** Find a column index by case-insensitive header name. */
function findCol(header: string[], name: string): number {
  const n = name.toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === n);
}

// ---------------------------------------------------------------------------
// Time window
// ---------------------------------------------------------------------------

function isInWindow(startHour: number, endHour: number): boolean {
  // Always evaluate in IST (Asia/Kolkata) — the server runs in UTC on AWS but
  // calling-window hours are configured in Indian Standard Time by the user.
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  return hour >= startHour && hour < endHour;
}

// ---------------------------------------------------------------------------
// Call trigger
// ---------------------------------------------------------------------------

/**
 * Place a call for one lead row, updating its DB status before and after.
 * Uses the lead's DB id for all updates (no row_hash dependency).
 */
async function fireLeadCall(
  clientId: string,
  leadId: number,
  campaignId: string,
  phone: string,
  name: string | null,
  email: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await query(
    `UPDATE gsheet_lead SET status = 'calling'
     WHERE client_id = $1 AND id = $2 AND status IN ('queued', 'failed')`,
    [clientId, leadId],
  );

  try {
    const result = await runWithTenant(clientId, async () => {
      const campaign = await getCampaign(campaignId);
      if (!campaign) throw new Error(`Campaign "${campaignId}" not found`);
      return placeCampaignCall({
        campaign,
        phone,
        callerName: name || undefined,
        email: email || undefined,
      });
    });

    await query(
      `UPDATE gsheet_lead SET status = 'called', call_uuid = $3, called_at = now(), error = NULL
       WHERE client_id = $1 AND id = $2`,
      [clientId, leadId, result.callUuid],
    );
    return { ok: true };
  } catch (e: any) {
    const error = String(e?.message || "call failed");
    await query(
      `UPDATE gsheet_lead SET status = 'failed', error = $3, called_at = now()
       WHERE client_id = $1 AND id = $2`,
      [clientId, leadId, error],
    );
    return { ok: false, error };
  }
}

/** Manually trigger a call for a lead by its DB id (from the UI). */
export async function triggerLeadCallById(
  clientId: string,
  leadId: number,
): Promise<{ ok: boolean; error?: string }> {
  const { rows: leads } = await query<LeadRow>(
    `SELECT * FROM gsheet_lead WHERE client_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [clientId, leadId],
  );
  if (!leads.length) return { ok: false, error: "Lead not found" };
  const lead = leads[0];

  if (!lead.conn_id) return { ok: false, error: "Lead has no connection reference" };

  const conn = await getGSheetConn(lead.conn_id);
  if (!conn) return { ok: false, error: "Sheet connection not found" };

  return fireLeadCall(clientId, leadId, conn.campaignId, lead.phone, lead.name, lead.email);
}

// ---------------------------------------------------------------------------
// Poll one connection
// ---------------------------------------------------------------------------

export interface PollResult {
  newRows: number;
  called: number;
  queued: number;
  flushed: number;
  /** Rows whose phone cell was missing or unparseable, so no lead was created. */
  skippedInvalid?: number;
  error?: string;
}

/**
 * Build the row_hash that identifies a lead within a connection.
 *
 * A lead is identified by its NORMALIZED PHONE NUMBER, never by its position in
 * the sheet. The old scheme hashed the row index, which broke the moment anyone
 * inserted or deleted a row in the middle of a sheet: every row below shifted,
 * so people already called looked "new" (and were called again) while genuinely
 * new rows landed on an index we had already processed (and were never called).
 *
 * Scoped to the connection, not the client: two different sheets may legitimately
 * target the same person for different campaigns.
 */
const HASH_PREFIX = "p1:";

function makeRowHash(conn: GSheetConn, phoneE164: string): string {
  return `${HASH_PREFIX}${conn.id}:${phoneE164}`;
}

// ---------------------------------------------------------------------------
// One-time migration: position-based row_hash -> phone-based row_hash
// ---------------------------------------------------------------------------

const HASH_SCHEME_KEY = "gsheet_hash_scheme";
const HASH_SCHEME_VERSION = 2;
let hashMigrationDone = false;

/**
 * Rewrite every existing lead's row_hash to the phone-based scheme, once.
 *
 * Without this, the first poll after the upgrade would see brand-new hashes for
 * everybody already in the queue and re-call the lot. Rows are processed oldest
 * first, so when the same number appears twice the original row wins; the loser
 * keeps its old hash, which is harmless — it is history, and a stale hash can
 * never block a future insert (nothing generates that shape any more).
 *
 * Idempotent and cheap to call: guarded in memory and by an app_config marker.
 */
export async function ensurePhoneHashMigration(): Promise<void> {
  if (hashMigrationDone) return;

  const { rows: marker } = await query<{ v: any }>(
    `SELECT v FROM app_config WHERE k = $1`,
    [HASH_SCHEME_KEY],
  );
  if (marker.length && Number(marker[0].v?.version) >= HASH_SCHEME_VERSION) {
    hashMigrationDone = true;
    return;
  }

  let migrated = 0, kept = 0, lastId = 0;
  for (;;) {
    const { rows: batch } = await query<{
      id: string; conn_id: string | null; phone: string; row_hash: string;
    }>(
      `SELECT id, conn_id, phone, row_hash FROM gsheet_lead
       WHERE id > $1 ORDER BY id LIMIT 500`,
      [lastId],
    );
    if (!batch.length) break;

    for (const r of batch) {
      lastId = Number(r.id);
      const phone = normalizePhone(r.phone);
      if (!r.conn_id || !phone) { kept++; continue; }

      const next = `${HASH_PREFIX}${r.conn_id}:${phone}`;
      if (r.row_hash === next) continue;

      // Skip rather than fail when another row already holds the target hash —
      // that row is the one that owns this phone number for this connection.
      const { rowCount } = await query(
        `UPDATE gsheet_lead g SET row_hash = $2
         WHERE g.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM gsheet_lead x
             WHERE x.client_id = g.client_id AND x.row_hash = $2
           )`,
        [r.id, next],
      );
      if (rowCount) migrated++; else kept++;
    }
  }

  await query(
    `INSERT INTO app_config (k, v) VALUES ($1, $2::jsonb)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [HASH_SCHEME_KEY, JSON.stringify({ version: HASH_SCHEME_VERSION })],
  );
  hashMigrationDone = true;
  console.info(
    `[gsheets] row_hash -> phone scheme: ${migrated} migrated, ${kept} left on the old hash (duplicates/unparseable)`,
  );
}

export async function pollClient(conn: GSheetConn): Promise<PollResult> {
  // No-op after the first call; must run before any hash is read or written.
  await ensurePhoneHashMigration();

  let rows: string[][];
  try {
    rows = await fetchSheetRows(conn.sheetId, conn.tabName);
  } catch (e: any) {
    const error = String(e?.message || "fetch failed");
    await query(
      `UPDATE gsheet_conn SET last_error = $2, last_synced_at = now() WHERE id = $1`,
      [conn.id, error],
    );
    return { newRows: 0, called: 0, queued: 0, flushed: 0, error };
  }

  if (rows.length < 1) {
    await query(
      `UPDATE gsheet_conn SET last_synced_at = now(), last_error = NULL WHERE id = $1`,
      [conn.id],
    );
    return { newRows: 0, called: 0, queued: 0, flushed: 0 };
  }

  const header = rows[0];
  const phoneCol = findCol(header, "phone");
  const nameCol  = findCol(header, "name");
  const emailCol = findCol(header, "email");

  if (phoneCol < 0) {
    const error = "No 'phone' column found in sheet header row";
    await query(
      `UPDATE gsheet_conn SET last_error = $2, last_synced_at = now() WHERE id = $1`,
      [conn.id, error],
    );
    return { newRows: 0, called: 0, queued: 0, flushed: 0, error };
  }

  // Scan EVERY data row, not just the ones past `lastRow`. Identity is the phone
  // number (see makeRowHash), so a re-scan is idempotent — and it is the only way
  // to stay correct when rows are inserted or deleted mid-sheet, which shifts every
  // row below them. The whole CSV is fetched on every poll regardless, so this
  // costs one extra SELECT, not an extra download.
  const dataRows = rows.slice(1);

  interface Candidate {
    phone: string;      // normalized E.164 — what we dial and what we store
    rowHash: string;
    name: string | null;
    email: string | null;
    rowIndex: number;   // 1-based, for display only
  }

  const candidates: Candidate[] = [];
  const seenInSheet = new Set<string>();
  let skippedInvalid = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const raw = (row[phoneCol] ?? "").trim();
    if (!raw) continue;

    const phone = normalizePhone(raw);
    // Guard against a stray "12" or a header repeated mid-sheet becoming a call.
    if (phone.replace(/\D+/g, "").length < 8) { skippedInvalid++; continue; }
    // The same number listed twice in one sheet is one person, so one call.
    if (seenInSheet.has(phone)) continue;
    seenInSheet.add(phone);

    candidates.push({
      phone,
      rowHash: makeRowHash(conn, phone),
      name:  nameCol  >= 0 ? (row[nameCol]  ?? "").trim() || null : null,
      email: emailCol >= 0 ? (row[emailCol] ?? "").trim() || null : null,
      rowIndex: i + 1,
    });
  }

  // One round-trip to find which of these we already hold, instead of an INSERT
  // per row: on a settled 5,000-row sheet a poll then writes nothing at all.
  const known = new Set<string>();
  if (candidates.length) {
    const { rows: hits } = await query<{ row_hash: string }>(
      `SELECT row_hash FROM gsheet_lead WHERE client_id = $1 AND row_hash = ANY($2::text[])`,
      [conn.clientId, candidates.map((c) => c.rowHash)],
    );
    for (const h of hits) known.add(h.row_hash);
  }

  const inWindow = isInWindow(conn.callStartHour, conn.callEndHour);
  let newRows = 0, called = 0, queued = 0;

  for (const c of candidates) {
    if (known.has(c.rowHash)) continue;

    // ON CONFLICT still guards the race with a concurrent manual poll.
    const { rows: inserted } = await query<{ id: string }>(
      `INSERT INTO gsheet_lead (client_id, conn_id, sheet_id, row_index, name, email, phone, row_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued')
       ON CONFLICT (client_id, row_hash) DO NOTHING
       RETURNING id`,
      [conn.clientId, conn.id, conn.sheetId, c.rowIndex, c.name, c.email, c.phone, c.rowHash],
    );
    if (!inserted.length) continue; // another poll got there first

    newRows++;
    const leadId = Number(inserted[0].id);
    if (inWindow) {
      await fireLeadCall(conn.clientId, leadId, conn.campaignId, c.phone, c.name, c.email);
      called++;
    } else {
      queued++;
    }
  }

  // `lastRow` is no longer a dedupe pointer — keep it as "data rows seen" for the UI.
  const newLastRow = dataRows.length;
  await query(
    `UPDATE gsheet_conn SET last_row = $2, last_synced_at = now(), last_error = NULL WHERE id = $1`,
    [conn.id, newLastRow],
  );

  // Flush previously-queued leads if we are now within the calling window.
  // Filter by conn_id so each connection only flushes its own leads.
  let flushed = 0;
  if (isInWindow(conn.callStartHour, conn.callEndHour)) {
    const { rows: pending } = await query<LeadRow>(
      `SELECT * FROM gsheet_lead WHERE client_id = $1 AND conn_id = $2
         AND status = 'queued' AND deleted_at IS NULL
       ORDER BY queued_at`,
      [conn.clientId, conn.id],
    );
    for (const r of pending) {
      await fireLeadCall(conn.clientId, Number(r.id), conn.campaignId, r.phone, r.name, r.email);
      flushed++;
    }
  }

  return { newRows, called, queued, flushed, skippedInvalid };
}

// ---------------------------------------------------------------------------
// Outcome update — called by the hangup webhook
// ---------------------------------------------------------------------------

/**
 * When a Plivo hangup arrives for a call placed from a GSheets lead, record the
 * outcome so the Sheet Auto-Dial UI can show Answered / Busy / No Answer / etc.
 * Matched by our internal call UUID (stored as `call_uuid` on the lead row).
 * No-ops when the UUID doesn't belong to any lead (e.g. a bulk-only call).
 */
export async function updateLeadOutcomeByCallUuid(
  callUuid: string,
  outcome: CallOutcome,
  hangupCause: string,
  durationSec: number,
): Promise<void> {
  await query(
    `UPDATE gsheet_lead
     SET call_outcome = $2, hangup_cause = $3, duration_sec = $4
     WHERE call_uuid = $1`,
    [callUuid, outcome, hangupCause || null, durationSec || null],
  );
}

// ---------------------------------------------------------------------------
// Poll all clients (called by the background poller interval)
// ---------------------------------------------------------------------------

export async function pollAllClients(): Promise<void> {
  let conns: ConnRow[];
  try {
    const res = await query<ConnRow>(`SELECT * FROM gsheet_conn WHERE enabled = true`);
    conns = res.rows;
  } catch (e) {
    console.error("[gsheets] pollAllClients: failed to load connections:", e);
    return;
  }

  for (const row of conns) {
    const conn = toConn(row);
    try {
      const r = await pollClient(conn);
      console.info(
        `[gsheets] poll conn=${conn.id} client=${conn.clientId}: +${r.newRows} rows, ` +
        `${r.called} called, ${r.queued} queued, ${r.flushed} flushed` +
        (r.skippedInvalid ? `, ${r.skippedInvalid} unusable phone(s)` : "") +
        (r.error ? `, error: ${r.error}` : ""),
      );
    } catch (e) {
      console.error(`[gsheets] poll error conn=${conn.id} client=${conn.clientId}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Call-UUID → conn name resolution (used by the Reports API)
// ---------------------------------------------------------------------------

/**
 * Given a list of Plivo call UUIDs, return a Map of callUuid → connName for
 * any calls that originated from a Sheet Auto-Dial lead.
 *
 * Falls back to the tab name when conn_name is NULL (i.e. the connection was
 * created before the custom-name feature was added).
 *
 * Non-gsheet calls simply won't appear in the map — callers should treat a
 * missing entry as "no sheet source" rather than erroring.
 */
export async function resolveConnNamesByCallUuids(
  callUuids: string[],
): Promise<Map<string, string>> {
  if (!callUuids.length) return new Map();
  const { rows } = await query<{ call_uuid: string; conn_name: string | null; tab_name: string }>(
    `SELECT gl.call_uuid, gc.conn_name, gc.tab_name
     FROM gsheet_lead gl
     JOIN gsheet_conn gc ON gl.conn_id = gc.id
     WHERE gl.call_uuid = ANY($1)`,
    [callUuids],
  );
  const result = new Map<string, string>();
  for (const r of rows) {
    if (r.call_uuid) {
      result.set(r.call_uuid, r.conn_name?.trim() || r.tab_name || "Sheet");
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Poller bootstrap (called from instrumentation.ts)
// ---------------------------------------------------------------------------

const G = globalThis as unknown as { __ivrGsheetsPollerStarted?: boolean };
const POLL_INTERVAL_MS = Number(process.env.GSHEETS_POLL_INTERVAL_MS) || 5 * 60 * 1000;

export async function startGsheetsPoller(): Promise<void> {
  if (G.__ivrGsheetsPollerStarted) return;
  G.__ivrGsheetsPollerStarted = true;
  // Move existing leads onto the phone-based hash before any poll can run, so
  // the first tick after a deploy cannot re-call people already in the queue.
  await ensurePhoneHashMigration().catch((e) =>
    console.error("[gsheets] row_hash migration failed — poller will retry on first poll:", e),
  );
  console.info(`[gsheets] poller started — interval ${POLL_INTERVAL_MS / 1000}s`);
  const timer = setInterval(() => void pollAllClients(), POLL_INTERVAL_MS);
  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();
}
