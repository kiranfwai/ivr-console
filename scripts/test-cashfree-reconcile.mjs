/**
 * The Cashfree safety net (src/lib/cashfree-reconcile.ts) against a stand-in
 * Cashfree. Run on the isolated test DB only:
 *   PGDATABASE=ivr_cs WORKER_DISABLED=0 CASHFREE_API_BASE=http://127.0.0.1:4630 CASHFREE_RECONCILE_MS=5000 \
 *     PLIVO_AUTH_ID= PLIVO_AUTH_TOKEN= PLIVO_FROM_NUMBER= npx next start -p 3100
 *   TEST_DB=ivr_cs node scripts/test-cashfree-reconcile.mjs
 * It writes a test-only Cashfree config into the TEST DB's app_config.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import pg from "pg";

const DB = process.env.TEST_DB || "ivr_cs";
if (DB === "ivr") { console.error("refusing to run against the main sandbox DB"); process.exit(1); }
let passed = 0, failed = 0;
const check = (l, a, e) => { const ok = JSON.stringify(a) === JSON.stringify(e); ok ? passed++ : failed++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${ok ? "" : `\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbConfig() {
  const env = {}; const f = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
  return { host: env.PGHOST || "127.0.0.1", port: Number(env.PGPORT || 5432), user: env.PGUSER || "postgres", password: env.PGPASSWORD || undefined, database: DB };
}

const tag = Date.now().toString(36);
const O = (k) => `wal_test_${k}_${tag}`;
const STATUS = { [O("paid")]: "PAID", [O("hand")]: "PAID", [O("adj")]: "PAID", [O("expired")]: "EXPIRED", [O("active")]: "ACTIVE", [O("young")]: "PAID" };
const asked = {};
const mock = http.createServer((req, res) => {
  const id = decodeURIComponent((req.url.match(/\/orders\/([^/?]+)/) || [])[1] || "");
  asked[id] = (asked[id] || 0) + 1;
  if (!STATUS[id]) { res.writeHead(404); res.end('{"message":"order not found"}'); return; }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ order_id: id, order_status: STATUS[id], order_amount: 1 }));
});

async function main() {
  await new Promise((r) => mock.listen(4630, "127.0.0.1", r));
  const db = new pg.Client(dbConfig()); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  await q(`INSERT INTO app_config (k, v) VALUES ('cashfree', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [JSON.stringify({ env: "production", appId: "test-app", secretKey: "test-secret" })]);
  const cid = `cli_reconcile_${tag}`;
  await q(`INSERT INTO client_wallet (client_id, balance) VALUES ($1, 1000) ON CONFLICT (client_id) DO UPDATE SET balance = 1000`, [cid]);
  const order = (id, amt, age) => q(`INSERT INTO wallet_order (order_id, client_id, amount, status, created_at) VALUES ($1,$2,$3,'created', now() - $4::interval)`, [id, cid, amt, age]);
  await order(O("paid"), 500, "5 minutes");
  await order(O("hand"), 700, "6 minutes");
  await order(O("adj"), 300, "7 minutes");
  await order(O("expired"), 900, "8 minutes");
  await order(O("active"), 400, "9 minutes");
  await order(O("young"), 200, "20 seconds");
  // Money already added by hand for the "hand" and "adj" orders (as on 13 Nov), balance included.
  await q(`INSERT INTO wallet_txn (client_id, type, amount, balance_after, description, ref, created_at) VALUES ($1,'topup',700,1700,'Payment received but not added',NULL, now() - interval '1 minute')`, [cid]);
  await q(`INSERT INTO wallet_txn (client_id, type, amount, balance_after, description, ref, created_at) VALUES ($1,'adjustment',300,2000,'Manual credit',NULL, now() - interval '1 minute')`, [cid]);
  await q(`UPDATE client_wallet SET balance = 2000 WHERE client_id=$1`, [cid]);

  console.log("waiting for the first sweep (starts ~20s after boot, then every 5s)…");
  const st = async (k) => (await q(`SELECT status FROM wallet_order WHERE order_id=$1`, [O(k)]))[0].status;
  for (let i = 0; i < 40 && (await st("paid")) !== "paid"; i++) await sleep(1000);
  await sleep(6000); // let one more sweep run, to prove nothing is credited twice

  const bal = Number((await q(`SELECT balance FROM client_wallet WHERE client_id=$1`, [cid]))[0].balance);
  const rows = async (ref) => (await q(`SELECT count(*)::int n FROM wallet_txn WHERE client_id=$1 AND ref=$2`, [cid, ref]))[0].n;

  console.log("\n1. paid but never credited");
  check("order marked paid", await st("paid"), "paid");
  check("credited exactly once", await rows(O("paid")), 1);
  console.log("\n2. paid and already added by hand");
  check("order marked paid", await st("hand"), "paid");
  check("hand-added row now carries the order id", (await q(`SELECT count(*)::int n FROM wallet_txn WHERE client_id=$1 AND ref=$2 AND description LIKE 'Payment received%'`, [cid, O("hand")]))[0].n, 1);
  check("no second credit row", await rows(O("hand")), 1);
  console.log("\n3. paid, but only a manual adjustment matches");
  check("left for a person (still created)", await st("adj"), "created");
  check("not credited", await rows(O("adj")), 0);
  console.log("\n4–6. expired / still open / too new");
  check("expired order closed as failed", await st("expired"), "failed");
  check("open order left alone", await st("active"), "created");
  check("brand-new order not asked yet", [await st("young"), asked[O("young")] || 0], ["created", 0]);
  console.log("\n7. the balance");
  check("only the missed ₹500 was added (2000 → 2500)", bal, 2500);

  await db.end(); mock.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
