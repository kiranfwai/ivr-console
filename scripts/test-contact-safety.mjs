/**
 * Contact-safety test — the four fixes that stop people being contacted twice
 * or against their wishes.
 *
 *   1. A retried bulk upload (same idempotency key) returns the job it already
 *      created — including when several retries race — instead of minting a
 *      second job. (The 22 Aug 2026 duplicate WhatsApp blast.)
 *   2. The Do-Not-Disturb list applies to WhatsApp: bulk sends, single sends and
 *      queued call follow-ups (lead_notify) all skip a DND number.
 *   3. A sheet lead is dialled only by whoever moves it out of 'queued'/'failed':
 *      a lead already 'calling' or 'called' is refused, and a lead left
 *      'calling' by a restart is marked failed rather than re-dialled.
 *
 * Runs against an ISOLATED database with the background workers ON, so the
 * lead-notify sender and the boot-time cleanup are exercised for real. Every
 * webhook points at a local catcher; Plivo credentials are blank. Nothing can
 * reach a real person.
 *
 * Usage:
 *   1. createdb ivr_cs   (any empty database on the local server)
 *   2. npm run build
 *   3. PGDATABASE=ivr_cs WORKER_DISABLED=0 PLIVO_AUTH_ID= PLIVO_AUTH_TOKEN= \
 *      PABBLY_WEBHOOK_URL=http://127.0.0.1:4620/hook npx next start -p 3100
 *   4. node scripts/test-contact-safety.mjs            (phase 1)
 *   5. restart the server (same command), then
 *      node scripts/test-contact-safety.mjs --after-restart   (phase 2)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://127.0.0.1:3100";
const DB = process.env.TEST_DB || "ivr_cs";
const HOOK_PORT = 4620;
const HOOK = `http://127.0.0.1:${HOOK_PORT}/hook`;
const ADMIN = { email: process.env.ADMIN_TEST_EMAIL || "admin@local", password: process.env.ADMIN_TEST_PASSWORD || "localdev" };
const CLIENT = { email: "contact-safety@local", password: "safety-test-1", name: "Contact safety test" };
const STATE_FILE = path.join(process.cwd(), ".contact-safety-state.json");

const DND_NUM = "+919000000101";
const OK_NUM_A = "+919000000102";
const OK_NUM_B = "+919000000103";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- webhook catcher ----------------------------------------------------------
const received = [];
const hookServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try { received.push(JSON.parse(body)); } catch { received.push({ raw: body }); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"success"}');
  });
});
const digits = (v) => String(v ?? "").replace(/\D/g, "");
const hits = (num) => received.filter((p) => JSON.stringify(p).includes(digits(num).slice(-10))).length;

// --- http ---------------------------------------------------------------------
function session() {
  let cookie = "";
  return async function call(pathname, init = {}) {
    const headers = { "content-type": "application/json", ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(APP + pathname, { ...init, headers, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
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
    database: DB,
  };
}

async function clientSession() {
  const admin = session();
  check("admin login", (await admin("/api/auth/login", { method: "POST", body: JSON.stringify(ADMIN) })).status, 200);
  const created = await admin("/api/admin/clients", {
    method: "POST",
    body: JSON.stringify({ ...CLIENT, perms: ["dial", "bulk", "campaigns", "audios", "reports", "whatsapp", "billing"] }),
  });
  if (![200, 201, 409].includes(created.status)) throw new Error("could not create test client: " + JSON.stringify(created));
  const s = session();
  const login = await s("/api/auth/login", { method: "POST", body: JSON.stringify({ email: CLIENT.email, password: CLIENT.password }) });
  if (login.status !== 200) throw new Error("test client login failed: " + JSON.stringify(login));
  const me = await s("/api/me");
  return { s, clientId: me.body.clientId };
}

const waJob = (s, key, rows) =>
  s("/api/bulk", {
    method: "POST",
    body: JSON.stringify({ kind: "whatsapp", rows, webhookUrl: HOOK, delayMs: 3_600_000, idempotencyKey: key }),
  });

// --- phase 1 -------------------------------------------------------------------
async function phase1(db) {
  const { s, clientId } = await clientSession();
  console.log(`client ${clientId}, app ${APP}, db ${DB}\n`);
  const run = Date.now().toString(36);

  console.log("1. duplicate bulk jobs");
  const rows2 = [{ phone: OK_NUM_A, name: "A" }, { phone: OK_NUM_B, name: "B" }];
  const first = await waJob(s, `cs-${run}-one`, rows2);
  const retry = await waJob(s, `cs-${run}-one`, rows2);
  check("first upload creates a job", first.status, 200);
  check("a retry with the same key returns the SAME job", retry.body.job?.id, first.body.job?.id);
  check("...and says it is the existing one", retry.body.idempotent, true);

  const racing = await Promise.all(Array.from({ length: 6 }, () => waJob(s, `cs-${run}-race`, rows2)));
  check("6 racing retries all succeed", racing.map((r) => r.status), Array(6).fill(200));
  check("...and all get ONE job between them", new Set(racing.map((r) => r.body.job?.id)).size, 1);
  const raceRows = await db.query(
    `SELECT count(*)::int AS n FROM bulk_row WHERE job_id IN (SELECT id FROM bulk_job WHERE idem_key=$1)`,
    [`cs-${run}-race`],
  );
  check("...holding the list once, not six times", raceRows.rows[0].n, 2);

  const other = await waJob(s, `cs-${run}-two`, rows2);
  check("a DIFFERENT key is a different job", other.body.job?.id !== first.body.job?.id, true);

  // Park them so the worker never sends this fixture traffic.
  for (const id of new Set([first.body.job?.id, racing[0].body.job?.id, other.body.job?.id])) {
    await s(`/api/bulk/${id}/pause`, { method: "POST" });
  }

  console.log("\n2. DND applies to WhatsApp");
  check("add a number to DND", (await s("/api/dnd", { method: "POST", body: JSON.stringify({ phones: [DND_NUM] }) })).status, 200);

  const job = await waJob(s, `cs-${run}-dnd`, [
    { phone: DND_NUM, name: "On DND" },
    { phone: OK_NUM_A, name: "A" },
    { phone: OK_NUM_B, name: "B" },
  ]);
  const jobId = job.body.job?.id;
  await s(`/api/bulk/${jobId}/pause`, { method: "POST" }); // the browser path drives it below, not the worker
  const before = received.length;
  const batch = await s(`/api/bulk/${jobId}/send-batch`, { method: "POST", body: JSON.stringify({ webhookUrl: HOOK, n: 10 }) });
  check("bulk batch sends the two allowed numbers", batch.body.sent, 2);
  check("...and does not count the DND skip as a failure", batch.body.failed, 0);
  check("DND number never reached the webhook", hits(DND_NUM), 0);
  check("the two others did", received.length - before, 2);
  const rowsRes = await s(`/api/bulk/${jobId}/rows?limit=10`);
  const byPhone = Object.fromEntries((rowsRes.body.rows || []).map((r) => [digits(r.phone).slice(-10), r.status]));
  check("DND row is marked 'dnd'", byPhone[digits(DND_NUM).slice(-10)], "dnd");

  const single = await s("/api/whatsapp/send", { method: "POST", body: JSON.stringify({ phone: DND_NUM, webhookUrl: HOOK }) });
  check("single send to a DND number is refused", single.status, 409);
  check("...with a plain message", /Do Not Disturb/.test(single.body.error || ""), true);
  check("...and nothing was posted", hits(DND_NUM), 0);
  const singleOk = await s("/api/whatsapp/send", { method: "POST", body: JSON.stringify({ phone: OK_NUM_A, webhookUrl: HOOK }) });
  check("single send to a normal number still works", singleOk.status, 200);

  // Queued call follow-ups (what "always" / answer campaigns send) — the sender
  // must skip DND at send time.
  await db.query(
    `INSERT INTO lead_notify (dedupe_key, client_id, source, phone, webhook_url, payload)
     VALUES ($1,$2,'bulk',$3,$4,$5), ($6,$2,'bulk',$7,$4,$8)`,
    [`cs-${run}-ln-dnd`, clientId, DND_NUM, HOOK, { phone: digits(DND_NUM) },
     `cs-${run}-ln-ok`, OK_NUM_B, { phone: digits(OK_NUM_B), marker: `ln-${run}` }],
  );
  let ln = [];
  for (let i = 0; i < 30; i++) {
    ln = (await db.query(`SELECT dedupe_key, status, error FROM lead_notify WHERE dedupe_key LIKE $1 ORDER BY dedupe_key`, [`cs-${run}-ln-%`])).rows;
    if (ln.every((r) => r.status !== "pending" && r.status !== "sending")) break;
    await sleep(1000);
  }
  const lnBy = Object.fromEntries(ln.map((r) => [r.dedupe_key.split("-").pop(), r]));
  check("queued follow-up to a DND number is skipped", lnBy.dnd?.status, "skipped");
  check("...recorded as 'on DND list'", lnBy.dnd?.error, "on DND list");
  check("queued follow-up to a normal number is sent", lnBy.ok?.status, "sent");
  check("DND number still never reached the webhook", hits(DND_NUM), 0);

  console.log("\n3. sheet leads are claimed, not double-dialled");
  const conn = `cs-conn-${run}`;
  await db.query(
    `INSERT INTO gsheet_conn (id, client_id, sheet_id, tab_name, campaign_id, conn_name, enabled)
     VALUES ($1,$2,'cs-sheet','Leads','cs-campaign','Contact safety', false)`,
    [conn, clientId],
  );
  const lead = async (status, phone) =>
    (await db.query(
      `INSERT INTO gsheet_lead (client_id, conn_id, sheet_id, row_index, phone, row_hash, status)
       VALUES ($1,$2,'cs-sheet',1,$3,$4,$5) RETURNING id`,
      [clientId, conn, phone, `cs-${run}-${status}-${phone}`, status],
    )).rows[0].id;
  const calling = await lead("calling", "+919000000201");
  const called = await lead("called", "+919000000202");

  const r1 = await s(`/api/gsheets/leads/${calling}/call`, { method: "POST" });
  check("a lead already 'calling' is refused", r1.status, 400);
  check("...with a plain reason", /already being called/.test(r1.body.error || ""), true);
  const r2 = await s(`/api/gsheets/leads/${called}/call`, { method: "POST" });
  check("a lead already 'called' is refused", r2.status, 400);
  const st = (await db.query(`SELECT id, status FROM gsheet_lead WHERE id = ANY($1::bigint[]) ORDER BY id`, [[calling, called]])).rows.map((r) => r.status);
  check("...and neither lead was touched", st, ["calling", "called"]);

  fs.writeFileSync(STATE_FILE, JSON.stringify({ run, clientId, conn, interrupted: Number(calling) }));
  console.log("\nnow restart the server and run with --after-restart");
}

// --- phase 2 -------------------------------------------------------------------
async function phase2(db) {
  const { run, conn, interrupted } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  console.log("4. a lead left mid-call by a restart");
  let row;
  for (let i = 0; i < 20; i++) {
    row = (await db.query(`SELECT status, error FROM gsheet_lead WHERE id=$1`, [interrupted])).rows[0];
    if (row.status !== "calling") break;
    await sleep(500);
  }
  check("is marked failed at boot, not re-dialled", row.status, "failed");
  check("...with a reason a person can act on", /interrupted by a restart/.test(row.error || ""), true);

  // Cleanup: only rows this test created.
  await db.query(`DELETE FROM gsheet_lead WHERE conn_id=$1`, [conn]);
  await db.query(`DELETE FROM gsheet_conn WHERE id=$1`, [conn]);
  await db.query(`DELETE FROM lead_notify WHERE dedupe_key LIKE $1`, [`cs-${run}-%`]);
  const jobs = (await db.query(`SELECT id FROM bulk_job WHERE idem_key LIKE $1`, [`cs-${run}-%`])).rows.map((r) => r.id);
  await db.query(`DELETE FROM bulk_row WHERE job_id = ANY($1)`, [jobs]);
  await db.query(`DELETE FROM bulk_job WHERE id = ANY($1)`, [jobs]);
  fs.rmSync(STATE_FILE, { force: true });
  console.log("  (fixture rows removed)");
}

async function main() {
  await new Promise((r) => hookServer.listen(HOOK_PORT, "127.0.0.1", r));
  const db = new pg.Client(dbConfig());
  await db.connect();
  try {
    if (process.argv.includes("--after-restart")) await phase2(db);
    else await phase1(db);
  } finally {
    await db.end();
    hookServer.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
