/**
 * Unattended WhatsApp sending.
 *
 * Bulk WhatsApp used to be paced by a loop in the browser: close the tab and the
 * rest of the send simply never happened, which also made scheduling one
 * pointless. The worker now drives it. This proves that — no browser, no
 * send-batch call from a client, nothing but the job sitting in the database.
 *
 * Requires a dev server started WITH the worker enabled and pointed at the
 * fixture webhook below:
 *
 *   WORKER_DISABLED=0 PABBLY_WEBHOOK_URL=http://127.0.0.1:4610/hook npm run dev
 *   node scripts/test-whatsapp-worker.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://localhost:3000";
const PORT = Number(process.env.FIXTURE_PORT || 4610);
const CLIENT = { email: "test@local", password: "testlocal" };

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  PASS  " + label); }
  else { failed++; console.log("  FAIL  " + label);
    console.log("        expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)); }
}

// --- fixture Pabbly: records every message it is handed --------------------
const received = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try { received.push(JSON.parse(body)); } catch { received.push({ raw: body }); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});

let cookie = "";
async function api(p, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(APP + p, { ...init, headers });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const t = await res.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!res.ok) throw new Error(`${init.method || "GET"} ${p} -> ${res.status} ${t.slice(0, 140)}`);
  return b;
}

function dbConfig() {
  const env = {};
  const f = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(f)) for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
  return { host: env.PGHOST || "127.0.0.1", port: Number(env.PGPORT || 5432), user: env.PGUSER || "postgres",
           password: env.PGPASSWORD || undefined, database: env.PGDATABASE || "ivr" };
}
const db = new pg.Client(dbConfig());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RECIPIENTS = Array.from({ length: 6 }, (_, i) => ({
  phone: `+9197000002${String(i).padStart(2, "0")}`, name: `Worker ${i}`,
}));

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  await db.connect();
  await api("/api/auth/login", { method: "POST", body: JSON.stringify(CLIENT) });
  console.log(`fixture webhook on :${PORT}, app at ${APP}\n`);

  // Nothing else may be dialling while the worker is on in a sandbox.
  await db.query(`UPDATE bulk_job SET status='paused' WHERE status='running' AND kind='call'`);

  const { job } = await api("/api/bulk", {
    method: "POST",
    body: JSON.stringify({
      kind: "whatsapp",
      rows: RECIPIENTS,
      webhookUrl: `http://127.0.0.1:${PORT}/hook`,
      delayMs: 1000,
      concurrency: 3,
    }),
  });
  check("the job starts in running", job.status, "running");

  // Now do nothing at all — no send-batch calls, no browser. Just wait.
  let done = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const j = await api(`/api/bulk/${job.id}`);
    if (j.job.status === "completed") { done = j.job; break; }
  }

  check("the worker finished the job with no browser involved", !!done, true);
  check("...delivering every message", received.length, RECIPIENTS.length);
  // The payload builder strips the leading '+' on purpose — Pabbly rejects it.
  check("...to the right numbers",
    received.map((r) => r.phone ?? r.Phone ?? r.number).filter(Boolean).sort(),
    RECIPIENTS.map((r) => r.phone.replace(/^\+/, "")).sort());

  const rows = await db.query(`SELECT status, count(*)::int n FROM bulk_row WHERE job_id=$1 GROUP BY 1`, [job.id]);
  const byStatus = Object.fromEntries(rows.rows.map((r) => [r.status, r.n]));
  check("...and marking every row ok", byStatus.ok, RECIPIENTS.length);

  // Pausing must actually stop the server, not just a loop in a tab.
  const { job: j2 } = await api("/api/bulk", {
    method: "POST",
    body: JSON.stringify({
      kind: "whatsapp", rows: RECIPIENTS,
      webhookUrl: `http://127.0.0.1:${PORT}/hook`, delayMs: 60000, concurrency: 1,
    }),
  });
  await api(`/api/bulk/${j2.id}/pause`, { method: "POST" });
  const countAfterPause = received.length;
  await sleep(4000);
  check("a paused job sends nothing more", received.length, countAfterPause);

  await db.query(`DELETE FROM bulk_job WHERE id = ANY($1)`, [[job.id, j2.id]]);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.end().catch(() => {}); server.close(); });
