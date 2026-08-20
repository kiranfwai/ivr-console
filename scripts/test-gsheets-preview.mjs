/**
 * Sheet preview test.
 *
 * "How many are in this sheet?" used to be unanswerable until a connection had
 * been saved and had polled at least once — and a sheet with no `phone` column
 * announced itself only by silently calling nobody. /api/gsheets/preview reads
 * a tab and reports what a poll would find, before anything is saved.
 *
 * The important property is what it does NOT do: it must not create a
 * connection, must not queue a lead, and must not dial. This checks the counts
 * and then checks the database is exactly as it was.
 *
 * Usage (local sandbox DB running):
 *   1. GSHEETS_CSV_BASE=http://127.0.0.1:4604 npm run dev
 *   2. node scripts/test-gsheets-preview.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP   = process.env.APP_URL || "http://localhost:3000";
const PORT  = Number(process.env.FIXTURE_PORT || 4604);
const EMAIL = process.env.TEST_EMAIL || "test@local";
const PASS  = process.env.TEST_PASSWORD || "testlocal";
const SHEET = "fixture-preview-sheet";
const GID   = "5150";

// --- fixture sheet ---------------------------------------------------------
//
// The good tab: 6 data rows -> 3 dialable numbers, 1 blank, 1 unreadable
// ("12"), 1 duplicate of the first.
const GOOD = [
  "name,email,phone",
  "A,a@x.com,+919700000001",
  "B,b@x.com,9700000002",
  "C,c@x.com,",
  "D,d@x.com,12",
  "E,e@x.com,+919700000003",
  "F,f@x.com,9700000001",
].join("\n");

// The tab people actually build: no header row the app can use.
const HEADERLESS = ["Mani,9982863854165", "Mahi,9982863854166"].join("\n");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const gid = url.searchParams.get("gid");
  const sheet = url.searchParams.get("sheet");
  const csv = gid === GID ? HEADERLESS : sheet === "Leads" ? GOOD : null;
  if (csv === null) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`no such tab (gid=${gid}, sheet=${sheet})`);
    return;
  }
  res.writeHead(200, { "content-type": "text/csv" });
  res.end(csv);
});

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
async function api(pathname, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(APP + pathname, { ...init, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
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
const counts = () =>
  db.query("SELECT (SELECT count(*) FROM gsheet_conn) c, (SELECT count(*) FROM gsheet_lead) l")
    .then((r) => r.rows[0]);

const preview = (body) =>
  api("/api/gsheets/preview", { method: "POST", body: JSON.stringify(body) });

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  await db.connect();
  console.log("fixture sheet on :" + PORT + ", app at " + APP + "\n");

  await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const before = await counts();

  // 1. A normal sheet, targeted by tab name.
  const good = await preview({ sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}`, tabName: "Leads" });
  check("reports every data row", good.rows, 6);
  check("counts the dialable numbers", good.usable, 3);
  check("counts unreadable phone cells", good.invalid, 1);
  check("counts empty phone cells separately", good.blank, 1);
  check("counts duplicates", good.duplicates, 1);
  check("reports the header", good.header, ["name", "email", "phone"]);
  check("no error", good.error, null);

  // 2. A sheet whose first row is data, not headers — the common real mistake.
  const headerless = await preview({
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${GID}`,
  });
  check("headerless sheet is reported as an error", headerless.error, "No 'phone' column found in sheet header row");
  check("...but says the tab was read", headerless.rows, 1);
  check("...and shows what the first row held", headerless.header, ["Mani", "9982863854165"]);
  check("...via the gid from the link", headerless.tab.gid, GID);

  // 3. A tab that does not exist fails, rather than reporting someone else's rows.
  const missing = await preview({
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}`,
    tabName: "Nope",
  });
  check("a missing tab is an error", missing.ok, false);
  check("...naming the HTTP failure", missing.error, "Google Sheets returned HTTP 400");

  // 4. The whole point: none of that touched anything.
  check("no connection or lead was created", await counts(), before);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await db.end().catch(() => {});
    server.close();
  });
