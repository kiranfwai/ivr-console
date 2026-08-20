/**
 * Sheet Auto-Dial tab-targeting test.
 *
 * A connection reads exactly ONE tab. Historically it picked that tab by NAME,
 * defaulting to "Sheet1" — so pasting the URL of a sheet while sitting on some
 * other tab silently dialled whatever happened to be on Sheet1, and renaming a
 * tab in Google broke the connection. A tab's `gid` (the `#gid=` at the end of
 * the address bar) identifies it exactly and never changes.
 *
 * This proves the connection reads the tab the URL points at, that targeting by
 * name still works for connections that want it, and that switching between the
 * two actually takes effect rather than leaving a stale gid to win quietly.
 *
 * Runs entirely locally — a fixture HTTP server stands in for the Google CSV
 * export and serves a DIFFERENT tab depending on how it was asked, so reading
 * the wrong tab shows up as the wrong phone numbers. The calling window is a
 * closed one, so leads stay queued and nothing dials.
 *
 * Usage (local sandbox DB running):
 *   1. GSHEETS_CSV_BASE=http://127.0.0.1:4602 npm run dev
 *   2. node scripts/test-gsheets-gid.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP   = process.env.APP_URL || "http://localhost:3000";
const PORT  = Number(process.env.FIXTURE_PORT || 4602);
const EMAIL = process.env.TEST_EMAIL || "test@local";
const PASS  = process.env.TEST_PASSWORD || "testlocal";
const SHEET = "fixture-gid-sheet";
const GID   = "1874320011";

// --- fixture sheet: three tabs, each with its own numbers -------------------

const TABS = {
  // keyed by gid
  byGid: {
    [GID]: "name,email,phone\nGid Lead,gid@x.com,+919111000001",
  },
  // keyed by tab name
  byName: {
    Sheet1:      "name,email,phone\nSheet1 Lead,s1@x.com,+919222000001",
    "Hot Leads": "name,email,phone\nNamed Lead,hot@x.com,+919333000001",
  },
};

/** Every request the fixture served, so the test can assert HOW it was asked. */
const requests = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const gid = url.searchParams.get("gid");
  const sheet = url.searchParams.get("sheet");
  requests.push({ gid, sheet });

  const csv = gid ? TABS.byGid[gid] : TABS.byName[sheet ?? ""];
  if (!csv) {
    // What Google does for a tab that does not exist: an error, not a fallback.
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(`no such tab (gid=${gid}, sheet=${sheet})`);
    return;
  }
  res.writeHead(200, { "content-type": "text/csv" });
  res.end(csv);
});

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
  if (!res.ok) {
    const err = new Error((init.method || "GET") + " " + pathname + " -> " + res.status + " " + text.slice(0, 200));
    err.status = res.status;
    err.body = body;
    throw err;
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

/** The phone numbers a connection queued, so we can tell WHICH tab it read. */
async function phonesFor(connId) {
  const { rows } = await db.query(
    "SELECT phone FROM gsheet_lead WHERE conn_id = $1 AND deleted_at IS NULL ORDER BY phone",
    [connId],
  );
  return rows.map((r) => r.phone);
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

const created = [];

async function connect(body) {
  const { connection } = await api("/api/gsheets/config", {
    method: "POST",
    body: JSON.stringify({ campaignId: created.campaignId, ...closedWindow(), ...body }),
  });
  created.push(connection.id);
  return connection;
}

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  await db.connect();
  console.log("fixture sheet on :" + PORT + ", app at " + APP + "\n");

  await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const { campaign } = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: "gid-test-" + Date.now() }),
  });
  created.campaignId = campaign.id;

  try {
    // 1. A URL copied straight from the address bar of an open tab.
    const fromLink = await connect({
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${GID}`,
      connName: "from link",
    });
    check("gid is taken from the pasted URL", fromLink.gid, GID);

    requests.length = 0;
    await api("/api/gsheets/poll", { method: "POST", body: JSON.stringify({ connId: fromLink.id }) });
    check("poll asked Google for that gid", requests, [{ gid: GID, sheet: null }]);
    check("and queued that tab's lead", await phonesFor(fromLink.id), ["+919111000001"]);

    // 2. No gid in the URL: the tab name still decides, as it always did.
    const byName = await connect({
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}`,
      tabName: "Hot Leads",
      connName: "by name",
    });
    check("no gid stored when the URL has none", byName.gid, null);

    requests.length = 0;
    await api("/api/gsheets/poll", { method: "POST", body: JSON.stringify({ connId: byName.id }) });
    check("poll asked by tab name", requests, [{ gid: null, sheet: "Hot Leads" }]);
    check("and queued the named tab's lead", await phonesFor(byName.id), ["+919333000001"]);

    // 3. The old default, unchanged: no gid, no name -> Sheet1. This is the
    //    behaviour that quietly dialled the wrong tab, so it must stay visible.
    const defaulted = await connect({
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}`,
      connName: "defaulted",
    });
    check("defaults to the Sheet1 name", [defaulted.gid, defaulted.tabName], [null, "Sheet1"]);
    await api("/api/gsheets/poll", { method: "POST", body: JSON.stringify({ connId: defaulted.id }) });
    check("and reads Sheet1", await phonesFor(defaulted.id), ["+919222000001"]);

    // 4. Explicitly asking for the name even though the link names a tab.
    const nameWins = await connect({
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${GID}`,
      tabName: "Hot Leads",
      tabMode: "name",
      connName: "name over gid",
    });
    check("tabMode 'name' discards the URL's gid", nameWins.gid, null);
    await api("/api/gsheets/poll", { method: "POST", body: JSON.stringify({ connId: nameWins.id }) });
    check("and reads the named tab", await phonesFor(nameWins.id), ["+919333000001"]);

    // 5. Asking for the gid when the link does not carry one is refused rather
    //    than silently falling back to a name — the whole point of the change.
    let refused = null;
    try {
      await connect({
        sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}`,
        tabMode: "gid",
        connName: "no gid to use",
      });
    } catch (e) {
      refused = e.status;
    }
    check("tabMode 'gid' with no gid in the URL is rejected", refused, 400);

    // 6. Switching an existing connection back to name targeting must actually
    //    clear the gid, or the old target would keep winning invisibly.
    const { connection: switched } = await api(`/api/gsheets/config/${fromLink.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${GID}`,
        tabName: "Hot Leads",
        tabMode: "name",
        campaignId: created.campaignId,
        ...closedWindow(),
      }),
    });
    check("switching to name clears the stored gid", switched.gid, null);

    requests.length = 0;
    await api("/api/gsheets/poll", { method: "POST", body: JSON.stringify({ connId: fromLink.id }) });
    check("and the poll now asks by name", requests, [{ gid: null, sheet: "Hot Leads" }]);

    // 7. ...and back again.
    const { connection: reGid } = await api(`/api/gsheets/config/${fromLink.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=${GID}`,
        tabMode: "gid",
        campaignId: created.campaignId,
        ...closedWindow(),
      }),
    });
    check("switching back restores the gid", reGid.gid, GID);
  } finally {
    for (const id of created) {
      await api(`/api/gsheets/config/${id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    await db.end().catch(() => {});
    server.close();
  });
