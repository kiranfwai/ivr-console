/**
 * Bulk calls → Past runs: paged + filtered job history from GET /api/bulk.
 * Isolated test DB only:
 *   PGDATABASE=ivr_cs WORKER_DISABLED=1 PLIVO_AUTH_ID= PLIVO_AUTH_TOKEN= PLIVO_FROM_NUMBER= npx next start -p 3100
 *   APP_URL=http://127.0.0.1:3100 TEST_DB=ivr_cs node scripts/test-run-history.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://127.0.0.1:3100";
const DB = process.env.TEST_DB || "ivr_cs";
if (DB === "ivr") { console.error("refusing to run against the main sandbox DB"); process.exit(1); }
let passed = 0, failed = 0;
const check = (l, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? passed++ : failed++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok ? "" : `\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`); };

function dbConfig() {
  const env = {}; const f = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
  return { host: env.PGHOST || "127.0.0.1", port: Number(env.PGPORT || 5432), user: env.PGUSER || "postgres", password: env.PGPASSWORD || undefined, database: DB };
}
function session() {
  let cookie = "";
  return async (p, init = {}) => {
    const headers = { "content-type": "application/json", ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const r = await fetch(APP + p, { ...init, headers, redirect: "manual" });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
    return { status: r.status, body: b };
  };
}

async function main() {
  const db = new pg.Client(dbConfig()); await db.connect();
  const s = session();
  check("client login", (await s("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "test@local", password: "testlocal" }) })).status, 200);
  const cid = (await s("/api/me")).body.clientId;
  const tag = Date.now().toString(36);
  const campA = `camp_hist_a_${tag}`, campB = `camp_hist_b_${tag}`;

  // 25 call runs in a far-past window (Jan 2003) so other test data can't overlap,
  // plus 3 WhatsApp runs that must never appear in the calls history.
  const base = Date.UTC(2003, 0, 1, 6, 0, 0);
  const ids = [];
  for (let i = 0; i < 25; i++) {
    const id = `blk_hist_${tag}_${String(i).padStart(2, "0")}`; ids.push(id);
    const status = i < 3 ? "running" : i < 8 ? "paused" : "completed";
    await db.query(
      `INSERT INTO bulk_job (id, client_id, kind, campaign_id, webhook_url, concurrency, delay_ms, jitter_pct, status, total, created_at)
       VALUES ($1,$2,'call',$3,'',10,0,0,$4,1,$5)`,
      [id, cid, i % 2 ? campB : campA, status, new Date(base + i * 86_400_000)]);
  }
  for (let i = 0; i < 3; i++) {
    await db.query(
      `INSERT INTO bulk_job (id, client_id, kind, campaign_id, webhook_url, concurrency, delay_ms, jitter_pct, status, total, created_at)
       VALUES ($1,$2,'whatsapp','','',10,0,0,'completed',1,$3)`,
      [`blk_hist_wa_${tag}_${i}`, cid, new Date(base + i * 86_400_000)]);
  }
  const win = `&from=${new Date(base - 1000).toISOString()}&to=${new Date(base + 40 * 86_400_000).toISOString()}`;
  const get = async (q) => (await s(`/api/bulk?kind=call${win}${q}`)).body;

  try {
    console.log("\n1. paging");
    const p1 = await get("&limit=10&offset=0");
    check("total counts all 25 call runs (WhatsApp runs excluded)", p1.total, 25);
    check("page 1 has 10", p1.jobs.length, 10);
    check("newest first", p1.jobs[0].id, ids[24]);
    const p3 = await get("&limit=10&offset=20");
    check("page 3 has the last 5", p3.jobs.length, 5);
    check("…ending with the oldest", p3.jobs[4].id, ids[0]);
    const all = [...p1.jobs, ...(await get("&limit=10&offset=10")).jobs, ...p3.jobs].map((j) => j.id);
    check("3 pages cover every run exactly once", new Set(all).size, 25);
    check("each job still carries its row counts object", typeof p1.jobs[0].counts, "object");

    console.log("\n2. filters");
    check("status running", (await get("&status=running")).total, 3);
    check("status paused (shown as Stopped)", (await get("&status=paused")).total, 5);
    check("status completed", (await get("&status=completed")).total, 17);
    check("campaign A", (await get(`&campaign=${campA}`)).total, 13);
    check("campaign B + completed", (await get(`&campaign=${campB}&status=completed`)).total, 8);
    const d = (await s(`/api/bulk?kind=call&from=${new Date(base + 5 * 86_400_000).toISOString()}&to=${new Date(base + 10 * 86_400_000).toISOString()}`)).body;
    check("date range: days 5–9 only", d.total, 5);
    check("junk status is ignored, not an error", (await get("&status=nope")).total, 25);
    check("limit is capped at 100", (await get("&limit=5000")).limit, 100);

    console.log("\n3. the old list is unchanged");
    const old = (await s("/api/bulk")).body;
    check("plain GET still returns { jobs } only", Object.keys(old).sort(), ["jobs"]);
    check("…at most 20 of them", old.jobs.length <= 20, true);
  } finally {
    await db.query(`DELETE FROM bulk_job WHERE id LIKE $1`, [`blk_hist_%${tag}%`]);
    await db.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
