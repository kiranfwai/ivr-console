/**
 * Sheet Auto-Dial dry run — what the phone-based dedupe change would actually do.
 *
 * The change on `fix/gsheets-phone-dedupe` stops identifying a lead by its ROW
 * POSITION and starts identifying it by its PHONE NUMBER, and retires `last_row`
 * as a dedupe pointer. That is the fix — but it means the first poll after the
 * deploy re-examines every row of every sheet, and anything it does not
 * recognise becomes a new lead and gets CALLED.
 *
 * This script answers the only question that matters before pushing: how many
 * calls would that first poll place, and are any of them people already called?
 * It reproduces the poll's logic exactly (same CSV parser, same phone
 * normalisation, same hash) and reports what WOULD happen.
 *
 * It never dials and never writes. The whole run happens inside a READ ONLY
 * transaction, so a stray INSERT/UPDATE/DDL aborts with an error rather than
 * touching anything. The only outbound traffic is fetching each connection's
 * public Google Sheet CSV — the same request the poller already makes.
 *
 * Usage (from the repo root):
 *
 *   # against the live database, read-only
 *   DATABASE_URL='postgres://user:pass@host:5432/db' node scripts/dryrun-gsheets-dedupe.mjs
 *
 *   # against the local sandbox (reads .env.local for PGHOST/PGPORT/...)
 *   node scripts/dryrun-gsheets-dedupe.mjs
 *
 * Options:
 *   --all             include disabled connections (default: only enabled ones,
 *                     since only those are polled)
 *   --client=<id>     restrict to one client
 *   --conn=<id>       restrict to one connection
 *   --samples=<n>     example numbers to print per connection (default 10)
 *   --mask            mask the middle digits of printed numbers
 *   --json            emit machine-readable JSON instead of the report
 *   --timeout=<ms>    per-sheet fetch timeout (default 20000, same as the poller)
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const INCLUDE_DISABLED = flag("all");
const ONLY_CLIENT = opt("client", null);
const ONLY_CONN = opt("conn", null);
const SAMPLES = Number(opt("samples", 10));
const MASK = flag("mask");
const AS_JSON = flag("json");
const FETCH_TIMEOUT = Number(opt("timeout", 20000));

// ---------------------------------------------------------------------------
// Copies of the app's logic
//
// Deliberate copies, not imports: importing src/lib/gsheets.ts would pull in
// src/lib/db.ts, whose every query runs the schema bootstrap — DDL writes, which
// is exactly what a dry run against live must not do. These must stay in step
// with src/lib/phone.ts and src/lib/gsheets.ts; if the real poll ever disagrees
// with this script, drift here is the first place to look.
// ---------------------------------------------------------------------------

/** Copy of src/lib/phone.ts normalizePhone(). */
function normalizePhone(raw, defaultCountry = "91") {
  const trimmed = (raw || "").trim();
  let digits = trimmed.replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.startsWith(defaultCountry) && digits.length === 10 + defaultCountry.length) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/** Copy of src/lib/gsheets.ts parseCsv(). */
function parseCsv(csv) {
  const rows = [];
  let cur = [];
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
      } else if (ch === ",") {
        cur.push(field); field = "";
      } else if (ch === "\n") {
        cur.push(field); field = "";
        if (cur.some((c) => c.trim())) rows.push(cur);
        cur = [];
      } else if (ch !== "\r") {
        field += ch;
      }
    }
  }
  if (field || cur.length) { cur.push(field); if (cur.some((c) => c.trim())) rows.push(cur); }
  return rows;
}

/** Copy of src/lib/gsheets.ts findCol(). */
function findCol(header, name) {
  const n = name.toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === n);
}

/** Copy of src/lib/gsheets.ts isInWindow() — hours are IST, always. */
function istHour() {
  return Number(
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false })
      .format(new Date()),
  );
}
function isInWindow(startHour, endHour) {
  const hour = istHour();
  return hour >= startHour && hour < endHour;
}

/** Copy of the new src/lib/gsheets.ts makeRowHash(). */
const HASH_PREFIX = "p1:";
const makeRowHash = (connId, phoneE164) => `${HASH_PREFIX}${connId}:${phoneE164}`;

/** Copy of the poller's CSV export URL. */
const CSV_BASE = process.env.GSHEETS_CSV_BASE || "https://docs.google.com";
async function fetchSheetRows(sheetId, tabName) {
  const url =
    `${CSV_BASE}/spreadsheets/d/${encodeURIComponent(sheetId)}` +
    `/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Google Sheets returned HTTP ${res.status}`);
    return parseCsv(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// DB connection — same env precedence as src/lib/db.ts
// ---------------------------------------------------------------------------

function envFile() {
  const env = {};
  const file = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return env;
}

function dbConfig() {
  const env = { ...envFile(), ...process.env };
  const conn = env.DATABASE_URL || env.POSTGRES_URL;
  const ssl =
    /^(require|true|1)$/i.test(env.PGSSL || "") || /sslmode=require/.test(conn || "")
      ? { rejectUnauthorized: false }
      : undefined;
  if (conn) return { connectionString: conn, ssl };
  return {
    host: env.PGHOST || "127.0.0.1",
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || "postgres",
    password: env.PGPASSWORD || undefined,
    database: env.PGDATABASE || "ivr",
    ssl,
  };
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

const show = (phone) =>
  MASK && phone.length > 6
    ? `${phone.slice(0, 4)}${"*".repeat(phone.length - 6)}${phone.slice(-2)}`
    : phone;

const money = (n, currency = "INR") =>
  `${currency === "INR" ? "Rs " : currency + " "}${n.toFixed(2)}`;

const digits10 = (p) => (p || "").replace(/\D+/g, "").slice(-10);

/**
 * Escape a value being spliced into a LIKE pattern.
 *
 * Client ids look like `cli_mszxbcd4pvvkt2` — that underscore is a single-char
 * wildcard in LIKE, so an unescaped prefix could match a different client's
 * keys and over-report the risk.
 */
const likeEscape = (s) => s.replace(/([!%_])/g, "!$1");

// stdout discipline: in --json mode the JSON is the only thing on stdout.
function out(s) {
  if (!AS_JSON) console.log(s);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const db = new pg.Client(dbConfig());
const report = { generatedAt: new Date().toISOString(), connections: [], totals: {} };

async function main() {
  await db.connect();
  // Hard guarantee: nothing this script does can write. Any INSERT/UPDATE/DDL
  // (including an accidental schema bootstrap) aborts the transaction instead.
  await db.query("BEGIN TRANSACTION READ ONLY");
  await db.query("SET LOCAL statement_timeout = '120s'");

  const globalPricing = await loadGlobalPricing();
  const conns = await loadConns();
  if (!conns.length) {
    out("No Sheet Auto-Dial connections matched. Nothing to dry-run.");
    return;
  }

  for (const conn of conns) {
    report.connections.push(await dryRunConn(conn, globalPricing));
  }
  summarise();
}

async function loadGlobalPricing() {
  const { rows } = await db.query("SELECT v FROM app_config WHERE k = 'pricing'");
  const v = rows.length ? rows[0].v || {} : {};
  const rate = Number(v.perConnectedCall);
  return {
    // Falls back to DEFAULT_PRICING.perConnectedCall in src/lib/pricing.ts.
    perConnectedCall: Number.isFinite(rate) && rate >= 0 ? rate : 0.81,
    currency: typeof v.currency === "string" && v.currency.trim() ? v.currency.trim() : "INR",
  };
}

/**
 * Every phone number this client has ever been recorded as calling, as last-10
 * digits. Returns null if the scan could not be completed.
 *
 * Memoised per client: the scan walks `kv`, which has no index for this shape,
 * so doing it once per client beats doing it once per connection.
 *
 * Wrapped in a savepoint on purpose. On a large live `kv` this is the one query
 * that might hit statement_timeout, and a failed statement poisons the whole
 * enclosing transaction — without the savepoint one slow client would take the
 * entire report down with it. On failure the connection is reported as
 * "call history unchecked" rather than silently as "no repeats".
 */
const calledCache = new Map();
async function calledDigitsFor(clientId) {
  if (calledCache.has(clientId)) return calledCache.get(clientId);
  let result = null;
  await db.query("SAVEPOINT call_history");
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT right(regexp_replace(v->>'to', '\\D', '', 'g'), 10) AS d
         FROM kv
        WHERE k LIKE $1 ESCAPE '!'
          AND v->>'to' IS NOT NULL`,
      [`t:${likeEscape(clientId)}:call:%`],
    );
    await db.query("RELEASE SAVEPOINT call_history");
    result = new Set(rows.map((r) => r.d).filter((d) => d && d.length === 10));
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT call_history");
    out(`  (call-history scan failed for ${clientId}: ${e.message || e})`);
  }
  calledCache.set(clientId, result);
  return result;
}

async function loadConns() {
  const where = [];
  const params = [];
  if (!INCLUDE_DISABLED) where.push("c.enabled = true");
  if (ONLY_CLIENT) { params.push(ONLY_CLIENT); where.push(`c.client_id = $${params.length}`); }
  if (ONLY_CONN) { params.push(ONLY_CONN); where.push(`c.id = $${params.length}`); }
  const { rows } = await db.query(
    `SELECT c.*, cl.name AS client_name, cl.per_conn_call_cost, w.balance
       FROM gsheet_conn c
       LEFT JOIN app_client cl ON cl.id = c.client_id
       LEFT JOIN client_wallet w ON w.client_id = c.client_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.client_id, c.created_at`,
    params,
  );
  return rows;
}

async function dryRunConn(conn, globalPricing) {
  const label = `${conn.client_name || conn.client_id} / ${conn.conn_name || conn.tab_name} (${conn.id})`;
  const res = {
    connId: conn.id,
    clientId: conn.client_id,
    clientName: conn.client_name || null,
    connName: conn.conn_name || conn.tab_name,
    enabled: conn.enabled,
    sheetId: conn.sheet_id,
    tabName: conn.tab_name,
    window: {
      start: conn.call_start_hour,
      end: conn.call_end_hour,
      openNow: isInWindow(conn.call_start_hour, conn.call_end_hour),
    },
    error: null,
  };

  out(`\n=== ${label} ===`);
  if (!conn.enabled) out("  (connection is DISABLED — shown because of --all; the poller skips it)");

  let rows;
  try {
    rows = await fetchSheetRows(conn.sheet_id, conn.tab_name);
  } catch (e) {
    res.error = `sheet fetch failed: ${e.message || e}`;
    out(`  ERROR  ${res.error}`);
    return res;
  }

  if (rows.length < 1) {
    res.error = "sheet is empty";
    out("  sheet is empty — the poll would do nothing");
    return res;
  }

  const header = rows[0];
  const phoneCol = findCol(header, "phone");
  if (phoneCol < 0) {
    res.error = "No 'phone' column found in sheet header row";
    out(`  ERROR  ${res.error} — the poll records this error and calls nobody`);
    return res;
  }
  const dataRows = rows.slice(1);

  // --- rebuild the poll's candidate list, exactly as pollClient() does -------
  const candidates = [];
  const seenInSheet = new Set();
  let skippedInvalid = 0;
  let duplicatesInSheet = 0;
  let blankPhone = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const raw = (dataRows[i][phoneCol] ?? "").trim();
    if (!raw) { blankPhone++; continue; }
    const phone = normalizePhone(raw);
    if (phone.replace(/\D+/g, "").length < 8) { skippedInvalid++; continue; }
    if (seenInSheet.has(phone)) { duplicatesInSheet++; continue; }
    seenInSheet.add(phone);
    candidates.push({ phone, rowHash: makeRowHash(conn.id, phone), rowIndex: i + 1 });
  }

  // --- what the database already holds for this connection ------------------
  const { rows: leads } = await db.query(
    `SELECT id, phone, row_hash, status, deleted_at, called_at
       FROM gsheet_lead WHERE client_id = $1 AND conn_id = $2`,
    [conn.client_id, conn.id],
  );

  const hashSet = new Set(leads.map((l) => l.row_hash));
  const byPhone = new Map();
  for (const l of leads) {
    const p = normalizePhone(l.phone);
    if (!p) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(l);
  }

  // --- classify -------------------------------------------------------------
  let alreadyKeyed = 0;      // row_hash is already the phone-based one
  let migrationCovers = 0;   // old-style hash, but ensurePhoneHashMigration() rewrites it
  const fresh = [];          // no row at all -> the poll INSERTS and DIALS

  for (const c of candidates) {
    if (hashSet.has(c.rowHash)) { alreadyKeyed++; continue; }
    if (byPhone.has(c.phone)) { migrationCovers++; continue; }
    fresh.push(c);
  }

  // Phones held twice for one connection: in the migration the oldest row wins
  // the new hash and the other keeps its old one. Harmless (it is history), but
  // worth seeing — it means the sheet listed someone twice at some point.
  const migrationCollisions = [...byPhone.values()].filter((v) => v.length > 1).length;

  // Rows we hold that the sheet no longer lists — tombstones and removed rows.
  const goneFromSheet = leads.filter((l) => !seenInSheet.has(normalizePhone(l.phone))).length;
  const softDeleted = leads.filter((l) => l.deleted_at).length;

  // --- the headline risk: fresh numbers we have demonstrably called before ---
  // A number with no lead row that nonetheless appears in this client's call
  // history is almost certainly a row hard-DELETEd from the queue by the Clear
  // Queue / Delete Lead buttons on the current live code. Under `last_row` it
  // could never come back; after this change it looks brand new and is dialled.
  let previouslyCalled = [];
  let callHistoryChecked = true;
  if (fresh.length) {
    const calledDigits = await calledDigitsFor(conn.client_id);
    if (calledDigits) previouslyCalled = fresh.filter((c) => calledDigits.has(digits10(c.phone)));
    else callHistoryChecked = false;
  }
  const previouslyCalledSet = new Set(previouslyCalled);
  const neverCalled = fresh.filter((c) => !previouslyCalledSet.has(c));

  // --- cost -----------------------------------------------------------------
  const rate =
    conn.per_conn_call_cost == null ? globalPricing.perConnectedCall : Number(conn.per_conn_call_cost);
  const costCeiling = fresh.length * rate;

  Object.assign(res, {
    dataRows: dataRows.length,
    lastRow: conn.last_row,
    blankPhone,
    skippedInvalid,
    duplicatesInSheet,
    candidates: candidates.length,
    leadsHeld: leads.length,
    softDeleted,
    alreadyKeyed,
    migrationCovers,
    migrationCollisions,
    goneFromSheet,
    wouldCall: fresh.length,
    wouldCallPreviouslyCalled: previouslyCalled.length,
    callHistoryChecked,
    rate,
    costCeiling,
    walletBalance: conn.balance == null ? null : Number(conn.balance),
    currency: globalPricing.currency,
    samples: fresh.slice(0, SAMPLES).map((c) => ({ phone: c.phone, sheetRow: c.rowIndex + 1 })),
    previouslyCalledSamples: previouslyCalled
      .slice(0, SAMPLES)
      .map((c) => ({ phone: c.phone, sheetRow: c.rowIndex + 1 })),
  });

  // --- print ----------------------------------------------------------------
  out(`  sheet            ${dataRows.length} data rows, ${candidates.length} usable numbers` +
      (blankPhone ? `, ${blankPhone} blank` : "") +
      (skippedInvalid ? `, ${skippedInvalid} unusable` : "") +
      (duplicatesInSheet ? `, ${duplicatesInSheet} duplicate` : ""));
  out(`  database         ${leads.length} leads held for this connection` +
      (softDeleted ? ` (${softDeleted} already soft-deleted)` : "") +
      (goneFromSheet ? `, ${goneFromSheet} no longer in the sheet` : ""));
  out(`  recognised       ${alreadyKeyed} by phone hash, ${migrationCovers} via the one-time migration`);
  if (migrationCollisions) {
    out(`  duplicates       ${migrationCollisions} number(s) held twice — oldest row wins the new hash, no re-dial`);
  }

  // `last_row` over-running the sheet is the old bug's other half: rows counted
  // as "seen" without ever being read, so they were never called at all.
  if (conn.last_row > dataRows.length) {
    out(`  NOTE             last_row=${conn.last_row} exceeds the ${dataRows.length} rows in the sheet — ` +
        "rows the old code would never have called. Some new leads below are those.");
  }

  out(`  window           ${conn.call_start_hour}:00-${conn.call_end_hour}:00 IST — ` +
      `${res.window.openNow ? "OPEN right now" : "closed right now"} (IST hour is ${istHour()})`);

  if (!fresh.length) {
    out("  RESULT           0 new leads. The first poll after deploy would call NOBODY here.");
    return res;
  }

  out(`  RESULT           ${fresh.length} NEW lead(s) would be created` +
      (res.window.openNow
        ? " and DIALLED IMMEDIATELY"
        : " and queued — they dial as soon as the window opens"));
  out(`                   up to ${money(costCeiling, res.currency)} at ${money(rate, res.currency)}/connected call` +
      (res.walletBalance != null ? `, wallet holds ${money(res.walletBalance, res.currency)}` : ""));

  if (!callHistoryChecked) {
    out("  ** UNCHECKED **  the call-history scan failed, so whether any of these have been called");
    out("                   before is UNKNOWN. Treat the numbers below as unverified.");
  }

  if (previouslyCalled.length) {
    out(`  ** WARNING **    ${previouslyCalled.length} of them have ALREADY BEEN CALLED by this client before.`);
    out("                   Their lead row is gone from the database (hard-deleted by Clear Queue on the");
    out("                   current live code), so they would be called a SECOND time:");
    for (const c of previouslyCalled.slice(0, SAMPLES)) {
      out(`                     ${show(c.phone)}  (sheet row ${c.rowIndex + 1})`);
    }
    if (previouslyCalled.length > SAMPLES) {
      out(`                     ... and ${previouslyCalled.length - SAMPLES} more`);
    }
  }

  if (neverCalled.length) {
    // "No call history" is not quite "should be called": a lead cleared from the
    // queue BEFORE it ever dialled also lands here, and the clear used to be
    // permanent. Those people now get their call. Usually right, worth an eye.
    out(`  no call history  ${neverCalled.length} number(s) never dialled by this client — normally the`);
    out("                   backlog the old code skipped, but a lead cleared before it dialled looks");
    out("                   the same, and it would now be called:");
    for (const c of neverCalled.slice(0, SAMPLES)) {
      out(`                     ${show(c.phone)}  (sheet row ${c.rowIndex + 1})`);
    }
    if (neverCalled.length > SAMPLES) {
      out(`                     ... and ${neverCalled.length - SAMPLES} more`);
    }
  }
  return res;
}

function summarise() {
  const ok = report.connections.filter((c) => !c.error);
  const totals = {
    connections: report.connections.length,
    failed: report.connections.length - ok.length,
    wouldCall: ok.reduce((n, c) => n + (c.wouldCall || 0), 0),
    wouldCallPreviouslyCalled: ok.reduce((n, c) => n + (c.wouldCallPreviouslyCalled || 0), 0),
    costCeiling: ok.reduce((n, c) => n + (c.costCeiling || 0), 0),
    dialImmediately: ok
      .filter((c) => c.window && c.window.openNow)
      .reduce((n, c) => n + (c.wouldCall || 0), 0),
    unchecked: ok.filter((c) => c.callHistoryChecked === false).length,
  };
  report.totals = totals;

  out(`\n${"=".repeat(72)}`);
  out(`SUMMARY — ${totals.connections} connection(s) examined` +
      (totals.failed ? `, ${totals.failed} could not be read` : ""));
  out(`  calls the first poll would place : ${totals.wouldCall}` +
      (totals.dialImmediately ? `  (${totals.dialImmediately} immediately — window open)` : ""));
  out(`  of those, already called before  : ${totals.wouldCallPreviouslyCalled}`);
  out(`  worst-case wallet spend          : ${money(totals.costCeiling)} (if every call connects)`);
  out("");
  const gaps = [
    totals.failed ? `${totals.failed} connection(s) could not be read` : null,
    totals.unchecked ? `${totals.unchecked} connection(s) could not be checked against call history` : null,
  ].filter(Boolean);

  // A repeat call outranks everything: report it even if some connections failed.
  if (totals.wouldCallPreviouslyCalled > 0) {
    out(`VERDICT: HOLD — ${totals.wouldCallPreviouslyCalled} person(s) would be called a SECOND time.`);
    out("         Seed tombstone rows for those numbers (or remove them from the sheet) before deploying.");
    if (gaps.length) out(`         And there may be more: ${gaps.join(", ")}.`);
  } else if (gaps.length) {
    out(`VERDICT: INCOMPLETE — ${gaps.join(", ")}, so "no repeat calls" is NOT proven. Fix and re-run.`);
  } else if (totals.wouldCall === 0) {
    out("VERDICT: SAFE — the first poll after deploy would place no new calls at all.");
  } else {
    out(`VERDICT: OK — ${totals.wouldCall} new call(s), none of them a repeat. This is the backlog the old`);
    out("         code skipped. Deploy with the window closed if you want to eyeball the queue first.");
  }
}

main()
  .then(() => { if (AS_JSON) console.log(JSON.stringify(report, null, 2)); })
  .catch((e) => { console.error("dry run failed:", e); process.exitCode = 1; })
  .finally(async () => {
    try { await db.query("ROLLBACK"); } catch {}
    await db.end().catch(() => {});
  });
