import { query } from "./db";
import { runWithTenant } from "./tenant";
import { getCampaign } from "./campaigns";
import { placeCampaignCall } from "./place-campaign-call";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GSheetConfig {
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
}

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

type ConfigRow = {
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
};

type LeadRow = {
  id: string;
  client_id: string;
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

function toConfig(r: ConfigRow): GSheetConfig {
  return {
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
  };
}

function toLead(r: LeadRow): GSheetLead {
  return {
    id: Number(r.id),
    clientId: r.client_id,
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
// Config CRUD
// ---------------------------------------------------------------------------

export async function getGSheetConfig(clientId: string): Promise<GSheetConfig | null> {
  const { rows } = await query<ConfigRow>(
    `SELECT * FROM gsheet_config WHERE client_id = $1`,
    [clientId],
  );
  return rows.length ? toConfig(rows[0]) : null;
}

export interface SaveGSheetConfigInput {
  sheetId: string;
  tabName?: string;
  campaignId: string;
  callStartHour?: number;
  callEndHour?: number;
}

export async function saveGSheetConfig(
  clientId: string,
  input: SaveGSheetConfigInput,
): Promise<GSheetConfig> {
  const tabName = input.tabName?.trim() || "Sheet1";
  const callStartHour = input.callStartHour ?? 9;
  const callEndHour = input.callEndHour ?? 21;
  const { rows } = await query<ConfigRow>(
    `INSERT INTO gsheet_config (client_id, sheet_id, tab_name, campaign_id, call_start_hour, call_end_hour)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (client_id) DO UPDATE SET
       sheet_id        = EXCLUDED.sheet_id,
       tab_name        = EXCLUDED.tab_name,
       campaign_id     = EXCLUDED.campaign_id,
       call_start_hour = EXCLUDED.call_start_hour,
       call_end_hour   = EXCLUDED.call_end_hour,
       enabled         = true,
       last_error      = NULL
     RETURNING *`,
    [clientId, input.sheetId, tabName, input.campaignId, callStartHour, callEndHour],
  );
  return toConfig(rows[0]);
}

export async function deleteGSheetConfig(clientId: string): Promise<void> {
  await query(`DELETE FROM gsheet_config WHERE client_id = $1`, [clientId]);
  await query(`DELETE FROM gsheet_lead WHERE client_id = $1`, [clientId]);
}

export async function setGSheetEnabled(clientId: string, enabled: boolean): Promise<void> {
  await query(`UPDATE gsheet_config SET enabled = $2 WHERE client_id = $1`, [clientId, enabled]);
}

// ---------------------------------------------------------------------------
// Leads CRUD
// ---------------------------------------------------------------------------

export async function listLeads(clientId: string, limit = 300): Promise<GSheetLead[]> {
  const { rows } = await query<LeadRow>(
    `SELECT * FROM gsheet_lead WHERE client_id = $1 ORDER BY queued_at DESC LIMIT $2`,
    [clientId, limit],
  );
  return rows.map(toLead);
}

export async function deleteLead(clientId: string, id: number): Promise<void> {
  await query(`DELETE FROM gsheet_lead WHERE client_id = $1 AND id = $2`, [clientId, id]);
}

export async function clearLeads(clientId: string): Promise<void> {
  // Delete lead records but keep last_row so we don't re-process already-seen rows.
  await query(`DELETE FROM gsheet_lead WHERE client_id = $1`, [clientId]);
}

// ---------------------------------------------------------------------------
// Sheet fetch (no API key — uses public CSV export)
// ---------------------------------------------------------------------------

/** Extract sheet ID from a Google Sheets URL, or return the value as-is if already an ID. */
export function extractSheetId(urlOrId: string): string {
  const m = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : urlOrId.trim();
}

/** Fetch all rows from a publicly-shared Google Sheet as a 2-D string array. */
async function fetchSheetRows(sheetId: string, tabName: string): Promise<string[][]> {
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}` +
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

/** Place a call for one lead row, updating its status before and after. */
async function fireLeadCall(
  clientId: string,
  rowHash: string,
  campaignId: string,
  phone: string,
  name: string | null,
  email: string | null,
): Promise<{ ok: boolean; error?: string }> {
  await query(
    `UPDATE gsheet_lead SET status = 'calling'
     WHERE client_id = $1 AND row_hash = $2 AND status IN ('queued', 'failed')`,
    [clientId, rowHash],
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
       WHERE client_id = $1 AND row_hash = $2`,
      [clientId, rowHash, result.callUuid],
    );
    return { ok: true };
  } catch (e: any) {
    const error = String(e?.message || "call failed");
    await query(
      `UPDATE gsheet_lead SET status = 'failed', error = $3, called_at = now()
       WHERE client_id = $1 AND row_hash = $2`,
      [clientId, rowHash, error],
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
    `SELECT * FROM gsheet_lead WHERE client_id = $1 AND id = $2`,
    [clientId, leadId],
  );
  if (!leads.length) return { ok: false, error: "Lead not found" };
  const lead = leads[0];

  const { rows: configs } = await query<{ campaign_id: string }>(
    `SELECT campaign_id FROM gsheet_config WHERE client_id = $1`,
    [clientId],
  );
  if (!configs.length) return { ok: false, error: "Sheet not configured" };

  const rowHash = `${clientId}:${lead.sheet_id}:${lead.row_index}`;
  return fireLeadCall(clientId, rowHash, configs[0].campaign_id, lead.phone, lead.name, lead.email);
}

// ---------------------------------------------------------------------------
// Poll one client
// ---------------------------------------------------------------------------

export interface PollResult {
  newRows: number;
  called: number;
  queued: number;
  flushed: number;
  error?: string;
}

export async function pollClient(config: GSheetConfig): Promise<PollResult> {
  let rows: string[][];
  try {
    rows = await fetchSheetRows(config.sheetId, config.tabName);
  } catch (e: any) {
    const error = String(e?.message || "fetch failed");
    await query(
      `UPDATE gsheet_config SET last_error = $2, last_synced_at = now() WHERE client_id = $1`,
      [config.clientId, error],
    );
    return { newRows: 0, called: 0, queued: 0, flushed: 0, error };
  }

  if (rows.length < 1) {
    await query(
      `UPDATE gsheet_config SET last_synced_at = now(), last_error = NULL WHERE client_id = $1`,
      [config.clientId],
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
      `UPDATE gsheet_config SET last_error = $2, last_synced_at = now() WHERE client_id = $1`,
      [config.clientId, error],
    );
    return { newRows: 0, called: 0, queued: 0, flushed: 0, error };
  }

  // data rows = everything after header; new = not yet processed
  const dataRows = rows.slice(1);
  const newDataRows = dataRows.slice(config.lastRow);

  let newRows = 0, called = 0, queued = 0;

  for (let i = 0; i < newDataRows.length; i++) {
    const row = newDataRows[i];
    const phone = (row[phoneCol] ?? "").trim();
    if (!phone) continue;

    const name     = nameCol  >= 0 ? (row[nameCol]  ?? "").trim() || null : null;
    const email    = emailCol >= 0 ? (row[emailCol] ?? "").trim() || null : null;
    const rowIndex = config.lastRow + i + 1; // 1-based data row index
    const rowHash  = `${config.clientId}:${config.sheetId}:${rowIndex}`;

    const { rowCount } = await query(
      `INSERT INTO gsheet_lead (client_id, sheet_id, row_index, name, email, phone, row_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
       ON CONFLICT (client_id, row_hash) DO NOTHING`,
      [config.clientId, config.sheetId, rowIndex, name, email, phone, rowHash],
    );
    if (!rowCount) continue; // already processed

    newRows++;
    if (isInWindow(config.callStartHour, config.callEndHour)) {
      await fireLeadCall(config.clientId, rowHash, config.campaignId, phone, name, email);
      called++;
    } else {
      queued++;
    }
  }

  // Advance the last-read pointer
  const newLastRow = config.lastRow + newDataRows.length;
  await query(
    `UPDATE gsheet_config SET last_row = $2, last_synced_at = now(), last_error = NULL
     WHERE client_id = $1`,
    [config.clientId, newLastRow],
  );

  // Flush previously-queued leads if we are now within the calling window
  let flushed = 0;
  if (isInWindow(config.callStartHour, config.callEndHour)) {
    const { rows: pending } = await query<LeadRow>(
      `SELECT * FROM gsheet_lead WHERE client_id = $1 AND status = 'queued' ORDER BY queued_at`,
      [config.clientId],
    );
    for (const r of pending) {
      const rowHash = `${config.clientId}:${r.sheet_id}:${r.row_index}`;
      await fireLeadCall(config.clientId, rowHash, config.campaignId, r.phone, r.name, r.email);
      flushed++;
    }
  }

  return { newRows, called, queued, flushed };
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
// Poll all clients (called by the poller interval)
// ---------------------------------------------------------------------------

export async function pollAllClients(): Promise<void> {
  let configs: ConfigRow[];
  try {
    const res = await query<ConfigRow>(`SELECT * FROM gsheet_config WHERE enabled = true`);
    configs = res.rows;
  } catch (e) {
    console.error("[gsheets] pollAllClients: failed to load configs:", e);
    return;
  }

  for (const row of configs) {
    const config = toConfig(row);
    try {
      const r = await pollClient(config);
      console.info(
        `[gsheets] poll client=${config.clientId}: +${r.newRows} rows, ` +
        `${r.called} called, ${r.queued} queued, ${r.flushed} flushed` +
        (r.error ? `, error: ${r.error}` : ""),
      );
    } catch (e) {
      console.error(`[gsheets] poll error client=${config.clientId}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Poller bootstrap (called from instrumentation.ts)
// ---------------------------------------------------------------------------

const G = globalThis as unknown as { __ivrGsheetsPollerStarted?: boolean };
const POLL_INTERVAL_MS = Number(process.env.GSHEETS_POLL_INTERVAL_MS) || 5 * 60 * 1000;

export async function startGsheetsPoller(): Promise<void> {
  if (G.__ivrGsheetsPollerStarted) return;
  G.__ivrGsheetsPollerStarted = true;
  console.info(`[gsheets] poller started — interval ${POLL_INTERVAL_MS / 1000}s`);
  const timer = setInterval(() => void pollAllClients(), POLL_INTERVAL_MS);
  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();
}
