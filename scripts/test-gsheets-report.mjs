/**
 * Sheet call report test.
 *
 * Sheet Auto-Dial calls were only ever visible merged into their campaign's
 * totals, so two sheets feeding one campaign could not be told apart, and the
 * name/email/row behind a call was not in the report at all. /api/gsheets/report
 * answers "what did THIS sheet do", straight off the lead table.
 *
 * The properties that matter, and are all easy to get wrong:
 *   - a queued lead was never dialled and must not be counted;
 *   - a lead whose placement FAILED was still a call and must be;
 *   - a lead cleared from the queue must stay in history, or every report
 *     shrinks the next time somebody empties the queue;
 *   - days are IST, so 23:30 IST belongs to that day and not to the next one;
 *   - one connection's report must not contain another connection's calls, and
 *     another tenant's connection must not be readable at all.
 *
 * Seeds its own rows under a private sheet id and deletes them afterwards.
 *
 * Usage (local sandbox DB running):
 *   1. npm run dev
 *   2. node scripts/test-gsheets-report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://localhost:3000";
const EMAIL = process.env.TEST_EMAIL || "test@local";
const PASS = process.env.TEST_PASSWORD || "testlocal";

const SHEET = "fixture-report-sheet";
const CONN_A = "fixture-report-conn-a";
const CONN_B = "fixture-report-conn-b";
const CONN_OTHER = "fixture-report-conn-other";
const OTHER_CLIENT = "fixture-report-other-client";
const DAY1 = "2026-03-10";
const DAY2 = "2026-03-11";

// --- harness ---------------------------------------------------------------

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  PASS  " + label); }
  else {
    failed++;
    console.log("  FAIL  " + label);
    console.log("        expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

let cookie = "";
async function raw(pathname, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(APP + pathname, { ...init, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  return res;
}

async function api(pathname, init = {}) {
  const res = await raw(pathname, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const e = new Error((init.method || "GET") + " " + pathname + " -> " + res.status + " " + text.slice(0, 160));
    e.status = res.status;
    throw e;
  }
  return body;
}

function dbConfig() {
  const env = {};
  const file = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  }
  return {
    host: env.PGHOST || "127.0.0.1",
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || "postgres",
    password: env.PGPASSWORD || undefined,
    database: env.PGDATABASE || "ivr",
  };
}

const db = new pg.Client(dbConfig());

// --- fixture ---------------------------------------------------------------
//
// Times are written as IST wall clock and stored as timestamptz, which is
// exactly how a real call lands. Lead 2 sits at 23:30 IST — 18:00 UTC — and is
// the one that proves the day bucket is IST and not UTC.
//
//  #   conn  when (IST)        status  outcome      dur  note
//  1   A     2026-03-10 10:00  called  press1        45
//  2   A     2026-03-10 23:30  called  connected     30  late-night, still DAY1
//  3   A     2026-03-11 09:00  called  busy           -
//  4   A     2026-03-11 09:05  called  no-answer      -
//  5   A     2026-03-11 09:06  called  rejected       -
//  6   A     2026-03-11 09:07  failed  (none)         -  Plivo refused the call
//  7   A     2026-03-11 09:08  called  (none)         -  no hangup yet
//  8   A     never             queued  (none)         -  must NOT be counted
//  9   A     2026-03-11 10:00  called  press1        60  cleared from the queue
// 10   A     2026-03-11 11:00  called  connected     20  same phone as #1
// 11   B     2026-03-11 12:00  called  press1        99  other connection
// 12   other 2026-03-11 12:00  called  press1        99  other tenant
const LEADS = [
  { n: 1,  conn: CONN_A, at: `${DAY1} 10:00`, status: "called", outcome: "press1",    dur: 45, phone: "+919700000001" },
  { n: 2,  conn: CONN_A, at: `${DAY1} 23:30`, status: "called", outcome: "connected", dur: 30, phone: "+919700000002" },
  { n: 3,  conn: CONN_A, at: `${DAY2} 09:00`, status: "called", outcome: "busy",      dur: null, phone: "+919700000003" },
  { n: 4,  conn: CONN_A, at: `${DAY2} 09:05`, status: "called", outcome: "no-answer", dur: null, phone: "+919700000004" },
  { n: 5,  conn: CONN_A, at: `${DAY2} 09:06`, status: "called", outcome: "rejected",  dur: null, phone: "+919700000005" },
  { n: 6,  conn: CONN_A, at: `${DAY2} 09:07`, status: "failed", outcome: null,        dur: null, phone: "+919700000006", error: "Plivo refused" },
  { n: 7,  conn: CONN_A, at: `${DAY2} 09:08`, status: "called", outcome: null,        dur: null, phone: "+919700000007" },
  { n: 8,  conn: CONN_A, at: null,            status: "queued", outcome: null,        dur: null, phone: "+919700000008" },
  { n: 9,  conn: CONN_A, at: `${DAY2} 10:00`, status: "called", outcome: "press1",    dur: 60, phone: "+919700000009", deleted: true },
  { n: 10, conn: CONN_A, at: `${DAY2} 11:00`, status: "called", outcome: "connected", dur: 20, phone: "+919700000001" },
  { n: 11, conn: CONN_B, at: `${DAY2} 12:00`, status: "called", outcome: "press1",    dur: 99, phone: "+919700000011" },
  { n: 12, conn: CONN_OTHER, at: `${DAY2} 12:00`, status: "called", outcome: "press1", dur: 99, phone: "+919700000012", client: OTHER_CLIENT },
];

async function cleanup() {
  await db.query(`DELETE FROM gsheet_lead WHERE sheet_id = $1`, [SHEET]);
  await db.query(`DELETE FROM gsheet_conn WHERE id = ANY($1)`, [[CONN_A, CONN_B, CONN_OTHER]]);
}

async function seed(clientId) {
  await cleanup();
  for (const [id, client, name] of [
    [CONN_A, clientId, "August Leads"],
    [CONN_B, clientId, "Second Sheet"],
    [CONN_OTHER, OTHER_CLIENT, "Someone Else"],
  ]) {
    await db.query(
      `INSERT INTO gsheet_conn (id, client_id, sheet_id, tab_name, campaign_id, conn_name)
       VALUES ($1, $2, $3, 'Leads', 'fixture-campaign', $4)`,
      [id, client, SHEET, name],
    );
  }

  for (const l of LEADS) {
    // IST wall clock in, timestamptz out — the same conversion the report undoes.
    const calledAt = l.at ? `${l.at}:00 Asia/Kolkata` : null;
    await db.query(
      `INSERT INTO gsheet_lead
         (client_id, conn_id, sheet_id, row_index, name, email, phone, row_hash,
          status, call_uuid, call_outcome, hangup_cause, duration_sec, error,
          called_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16)`,
      [
        l.client || clientId,
        l.conn,
        SHEET,
        l.n,
        `Lead ${l.n}`,
        `lead${l.n}@fixture.test`,
        l.phone,
        `fixture:${l.conn}:${l.n}`,
        l.status,
        l.status === "queued" ? null : `fixture-uuid-${l.n}`,
        l.outcome,
        l.outcome === "busy" ? "Busy Line" : null,
        l.dur,
        l.error || null,
        calledAt,
        l.deleted ? new Date().toISOString() : null,
      ],
    );
  }
}

let CLIENT_ID = null;

const report = (qs) => api(`/api/gsheets/report?${qs}`);

async function main() {
  await db.connect();
  await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const me = await api("/api/me");
  CLIENT_ID = me.clientId;
  if (!CLIENT_ID) throw new Error("logged in as " + me.role + " — this test needs a client login");
  console.log(`client ${CLIENT_ID}, app at ${APP}\n`);

  await seed(CLIENT_ID);

  // --- 1. the whole range ---------------------------------------------------
  const all = await report(`conn=${CONN_A}&from=${DAY1}&to=${DAY2}`);
  const s = all.summary;
  check("counts only calls that were placed", s.dialled, 9);
  check("...so the queued lead is not in it", all.rows.some((r) => r.phone === "+919700000008"), false);
  check("...and the failed placement is", s.outcomes.failed, 1);
  check("...and the call with no hangup yet is in progress", s.outcomes["in-progress"], 1);
  check("...and a lead cleared from the queue still counts", s.outcomes.press1, 2);
  check("flags the cleared lead as cleared",
    all.rows.filter((r) => r.removedFromQueue).map((r) => r.phone), ["+919700000009"]);
  check("lifted = pressed 1 + connected", s.lifted, 4);
  check("lift rate is a percentage of calls placed", s.liftRate, 44);
  check("press-1 rate likewise", s.press1Rate, 22);
  check("talk time sums every duration", s.talkTimeSec, 155);
  check("average is over lifted calls only", s.avgDurationSec, 39);
  check("counts unique numbers, not rows", s.uniqueNumbers, 8);
  check("returns one row per placed call", all.rows.length, 9);
  check("carries the sheet's own name", s.connName, "August Leads");

  // --- 2. IST day buckets ---------------------------------------------------
  check("buckets days in IST", s.byDay, [
    { day: DAY1, dialled: 2, lifted: 2 },
    { day: DAY2, dialled: 7, lifted: 2 },
  ]);
  check("...so a 23:30 IST call stays on its own day", s.byHour["23"], 1);

  const d1 = await report(`conn=${CONN_A}&from=${DAY1}&to=${DAY1}`);
  check("a single IST day is inclusive of its whole evening", d1.summary.dialled, 2);
  check("...and does not leak into the next day", d1.summary.byDay.length, 1);
  const d2 = await report(`conn=${CONN_A}&from=${DAY2}&to=${DAY2}`);
  check("the following day holds the rest", d2.summary.dialled, 7);

  // --- 3. filters -----------------------------------------------------------
  const p1 = await report(`conn=${CONN_A}&from=${DAY1}&to=${DAY2}&outcome=press1`);
  check("outcome filter narrows the rows", p1.rows.length, 2);
  check("...but not the summary, so percentages hold still", p1.summary.dialled, 9);
  const lifted = await report(`conn=${CONN_A}&from=${DAY1}&to=${DAY2}&outcome=lifted`);
  check("'lifted' is a group of two outcomes", lifted.rows.length, 4);

  // --- 4. isolation ---------------------------------------------------------
  const b = await report(`conn=${CONN_B}&from=${DAY1}&to=${DAY2}`);
  check("a second connection reports only its own calls", b.summary.dialled, 1);
  check("...even though both feed the same campaign", b.rows[0].phone, "+919700000011");

  const other = await raw(`/api/gsheets/report?conn=${CONN_OTHER}&from=${DAY1}&to=${DAY2}`);
  check("another tenant's connection is not readable", other.status, 404);

  const noConn = await raw(`/api/gsheets/report`);
  check("conn is required", noConn.status, 400);

  // --- 5. exports -----------------------------------------------------------
  const csvRes = await raw(`/api/gsheets/report/csv?conn=${CONN_A}&from=${DAY1}&to=${DAY2}`);
  const csv = await csvRes.text();
  const lines = csv.trim().split("\n");
  check("CSV has a header and one line per call", lines.length, 10);
  check("...naming the columns", lines[0].startsWith("calledAtIST,calledAtUTC,sheetRow,name,email,phone,outcome"), true);
  check("...with a readable outcome", lines.some((l) => l.includes("Lifted + pressed 1")), true);
  check("...and the cleared lead marked", lines.some((l) => l.includes("+919700000009") && l.includes(",yes,")), true);
  check("...named after the sheet and range",
    csvRes.headers.get("content-disposition"),
    `attachment; filename="sheet-report-august-leads-${DAY1}_to_${DAY2}.csv"`);

  const csvFiltered = await raw(`/api/gsheets/report/csv?conn=${CONN_A}&from=${DAY1}&to=${DAY2}&outcome=busy`);
  check("CSV honours the outcome filter", (await csvFiltered.text()).trim().split("\n").length, 2);

  const xlsxRes = await raw(`/api/gsheets/report/xlsx?conn=${CONN_A}&from=${DAY1}&to=${DAY2}`);
  const xlsx = Buffer.from(await xlsxRes.arrayBuffer());
  check("XLSX is a real workbook", xlsx.subarray(0, 2).toString(), "PK");
  check("...served as a spreadsheet",
    xlsxRes.headers.get("content-type"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  const otherCsv = await raw(`/api/gsheets/report/csv?conn=${CONN_OTHER}`);
  check("exports are tenant-scoped too", otherCsv.status, 404);

  // --- 6. all time ----------------------------------------------------------
  const allTime = await report(`conn=${CONN_A}`);
  check("no range means all time", allTime.summary.dialled, 9);
  check("...and says so", [allTime.summary.from, allTime.summary.to], [null, null]);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup().catch(() => {});
    await db.end().catch(() => {});
  });
