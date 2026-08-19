/**
 * Sheet Auto-Dial dedupe test.
 *
 * Proves that a lead is identified by its phone number, not by its position in
 * the sheet: inserting, deleting or reordering rows must never re-call someone
 * already queued, and must never skip a genuinely new row. Also covers the
 * one-time migration of leads written by the previous, position-based scheme.
 *
 * Runs entirely locally - a fixture HTTP server stands in for the Google CSV
 * export, and the calling window is deliberately set to a closed one, so leads
 * stay queued and nothing dials.
 *
 * Usage (local sandbox DB running, and a FRESHLY started app so the one-time
 * migration has not run yet in that process):
 *   1. GSHEETS_CSV_BASE=http://127.0.0.1:4599 npm run dev
 *   2. node scripts/test-gsheets-dedupe.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP   = process.env.APP_URL || "http://localhost:3000";
const PORT  = Number(process.env.FIXTURE_PORT || 4599);
const EMAIL = process.env.TEST_EMAIL || "test@local";
const PASS  = process.env.TEST_PASSWORD || "testlocal";
const SHEET = "fixture-dedupe-sheet";

// --- fixture sheet ---------------------------------------------------------

let csv = "";
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/csv" });
  res.end(csv);
});

const rowsToCsv = (rows) => ["name,email,phone", ...rows.map((r) => r.join(","))].join("\n");

// --- tiny test harness -----------------------------------------------------

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log("  PASS  " + label);
  } else {
    failed++;
    console.log("  FAIL  " + label);
    console.log("        expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

// --- app helpers -----------------------------------------------------------

let cookie = "";
async function api(pathname, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(APP + pathname, { ...init, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error((init.method || "GET") + " " + pathname + " -> " + res.status + " " + text.slice(0, 200));
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

/** Every lead this connection holds, as "phone:status". */
async function leadsFor(connId) {
  const { rows } = await db.query(
    "SELECT phone, status FROM gsheet_lead WHERE conn_id = $1 ORDER BY phone",
    [connId],
  );
  return rows.map((r) => r.phone + ":" + r.status);
}

/** A calling window guaranteed to be CLOSED right now, so nothing dials. */
function closedWindow() {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false })
      .format(new Date()),
  );
  const start = (hour + 3) % 22;
  return { callStartHour: start, callEndHour: start + 1 };
}

// --- the test --------------------------------------------------------------

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  await db.connect();
  console.log("fixture sheet on :" + PORT + ", app at " + APP + "\n");

  await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const { campaign } = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: "dedupe-test-" + Date.now() }),
  });

  const { connection } = await api("/api/gsheets/config", {
    method: "POST",
    body: JSON.stringify({ sheetUrl: SHEET, campaignId: campaign.id, connName: "dedupe test", ...closedWindow() }),
  });
  const connId = connection.id;
  const poll = () => api("/api/gsheets/poll", { method: "POST", body: JSON.stringify({ connId }) });

  try {
    // A lead exactly as the previous version wrote it: hashed by row position,
    // already called. The upgrade must recognise this person, not call again.
    await db.query(
      "INSERT INTO gsheet_lead (client_id, conn_id, sheet_id, row_index, name, email, phone, row_hash, status)" +
      " VALUES ((SELECT client_id FROM gsheet_conn WHERE id = $1), $1, $2, 1, 'Legacy', 'legacy@x.com', '+919876500077', $3, 'called')",
      [connId, SHEET, connId + ":1"],
    );
    await db.query("DELETE FROM app_config WHERE k = 'gsheet_hash_scheme'");

    console.log("1. first poll after the upgrade");
    csv = rowsToCsv([
      ["Legacy", "legacy@x.com", "9876500077"],   // already called under the old scheme
      ["Asha", "asha@x.com", "9876500001"],
      ["Bhavna", "bhavna@x.com", "9876500002"],
      ["Chetan", "chetan@x.com", "9876500003"],
    ]);
    let r = await poll();
    check("3 new leads, the legacy one recognised", [r.newRows, r.called, r.queued], [3, 0, 3]);
    check("the legacy lead was NOT re-queued", await leadsFor(connId), [
      "+919876500001:queued", "+919876500002:queued", "+919876500003:queued", "+919876500077:called",
    ]);
    const migrated = await db.query("SELECT row_hash FROM gsheet_lead WHERE phone = '+919876500077'");
    check("its hash moved to the phone scheme", migrated.rows[0].row_hash, "p1:" + connId + ":+919876500077");

    console.log("2. re-poll with the sheet unchanged");
    r = await poll();
    check("nothing new", r.newRows, 0);

    console.log("3. a row inserted at the TOP shifts every row below it (the old bug)");
    csv = rowsToCsv([
      ["Zara", "zara@x.com", "9876500009"],      // new, at the top
      ["Asha", "asha@x.com", "9876500001"],
      ["Bhavna", "bhavna@x.com", "9876500002"],
      ["Chetan", "chetan@x.com", "9876500003"],
      ["Dev", "dev@x.com", "9876500004"],        // new, at the bottom
    ]);
    r = await poll();
    check("only the 2 genuinely new rows", r.newRows, 2);
    check("nobody duplicated", await leadsFor(connId), [
      "+919876500001:queued", "+919876500002:queued", "+919876500003:queued",
      "+919876500004:queued", "+919876500009:queued", "+919876500077:called",
    ]);

    console.log("3b. THREE rows inserted at the top - the re-call case");
    // Everyone below shifts onto row positions the old scheme had never seen,
    // so the previous version queued them all a second time and called them again.
    csv = rowsToCsv([
      ["New1", "n1@x.com", "9876500011"],
      ["New2", "n2@x.com", "9876500012"],
      ["New3", "n3@x.com", "9876500013"],
      ["Zara", "zara@x.com", "9876500009"],
      ["Asha", "asha@x.com", "9876500001"],
      ["Bhavna", "bhavna@x.com", "9876500002"],
      ["Chetan", "chetan@x.com", "9876500003"],
      ["Dev", "dev@x.com", "9876500004"],
    ]);
    r = await poll();
    check("only the 3 new people", r.newRows, 3);
    check("no one queued twice", await leadsFor(connId), [
      "+919876500001:queued", "+919876500002:queued", "+919876500003:queued",
      "+919876500004:queued", "+919876500009:queued", "+919876500011:queued",
      "+919876500012:queued", "+919876500013:queued", "+919876500077:called",
    ]);

    console.log("4. deleting a row in the middle");
    csv = rowsToCsv([
      ["New1", "n1@x.com", "9876500011"],
      ["New2", "n2@x.com", "9876500012"],
      ["New3", "n3@x.com", "9876500013"],
      ["Zara", "zara@x.com", "9876500009"],
      ["Asha", "asha@x.com", "9876500001"],
      ["Chetan", "chetan@x.com", "9876500003"],  // Bhavna removed
      ["Dev", "dev@x.com", "9876500004"],
    ]);
    r = await poll();
    check("nothing new", r.newRows, 0);
    check("the removed lead is kept as history, not re-added", (await leadsFor(connId)).length, 9);

    console.log("5. the same number twice in one sheet is one person");
    csv = rowsToCsv([
      ["Zara", "zara@x.com", "9876500009"],
      ["Esha", "esha@x.com", "9876500005"],
      ["Esha dup", "esha2@x.com", "+91 98765 00005"],   // same number, different formatting
    ]);
    r = await poll();
    check("one new lead, not two", r.newRows, 1);

    console.log("6. unusable phone cells");
    csv = rowsToCsv([["Bad", "bad@x.com", "12"], ["Blank", "blank@x.com", ""]]);
    r = await poll();
    check("no lead created", r.newRows, 0);
    check("the too-short number is reported as unusable", r.skippedInvalid, 1);
    console.log("7. clearing the visible queue must not re-import anyone");
    csv = rowsToCsv([
      ["Zara", "zara@x.com", "9876500009"],
      ["Esha", "esha@x.com", "9876500005"],
    ]);
    await poll();
    await api("/api/gsheets/leads", { method: "DELETE" });
    check("the queue looks empty to the user", (await api("/api/gsheets/leads")).leads.length, 0);
    r = await poll();
    check("but the poller still remembers them", r.newRows, 0);
    check("nothing came back into the queue", (await api("/api/gsheets/leads")).leads.length, 0);

  } finally {
    console.log("\ncleaning up");
    await db.query("DELETE FROM gsheet_lead WHERE conn_id = $1", [connId]);
    await db.query("DELETE FROM gsheet_conn WHERE id = $1", [connId]);
    await db.query("DELETE FROM app_config WHERE k = 'gsheet_hash_scheme'");
    await db.end();
    server.close();
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("test error:", e); process.exit(1); });
