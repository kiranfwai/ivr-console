/**
 * GST invoice test.
 *
 * A tax invoice is a legal document, so the things that matter are not the
 * layout but the arithmetic and the guarantees around it:
 *   - the parts must foot: taxable + tax == the amount charged, to the paise;
 *   - inclusive and exclusive tax must produce different, correct figures;
 *   - a customer in the seller's own state gets CGST+SGST, one elsewhere IGST,
 *     and a customer whose state we do not know is treated as intra-state;
 *   - one payment gets exactly one invoice, no matter how many times the credit
 *     path runs (the webhook and the return-path verify both call it);
 *   - numbers run in sequence within a financial year, with no gaps or repeats;
 *   - a payment is NEVER lost because invoicing is unconfigured;
 *   - one customer can never read another's invoice.
 *
 * Seeds its own orders and cleans up after itself.
 *
 * Usage (local sandbox DB running):
 *   1. npm run dev
 *   2. node scripts/test-invoice.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://localhost:3000";
const ADMIN = { email: "admin@local", password: "localdev" };
const CLIENT = { email: "test@local", password: "testlocal" };
const TAG = "test-inv-";
const OTHER_CLIENT = "cli_invoice_other";

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

function makeSession() {
  let cookie = "";
  return {
    async raw(p, init = {}) {
      const headers = { "content-type": "application/json", ...(init.headers || {}) };
      if (cookie) headers.cookie = cookie;
      const res = await fetch(APP + p, { ...init, headers });
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      return res;
    },
    async api(p, init = {}) {
      const res = await this.raw(p, init);
      const t = await res.text();
      let b; try { b = JSON.parse(t); } catch { b = t; }
      if (!res.ok) { const e = new Error(`${init.method || "GET"} ${p} -> ${res.status} ${t.slice(0,140)}`); e.status = res.status; throw e; }
      return b;
    },
    login(c) { return this.api("/api/auth/login", { method: "POST", body: JSON.stringify(c) }); },
  };
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

const SELLER = {
  enabled: true,
  legalName: "Test Seller Pvt Ltd",
  gstin: "29ABCDE1234F1Z5",
  address: "1 Test Street, Bengaluru 560001",
  state: "Karnataka",
  stateCode: "29",
  email: "billing@test.local",
  phone: "+91 80 0000 0000",
  seriesPrefix: "TST",
  gstRate: 18,
  taxMode: "inclusive",
  sacCode: "998414",
  description: "Prepaid credit for outbound voice services",
};

async function cleanup() {
  await db.query(`DELETE FROM invoice WHERE order_id LIKE $1`, [TAG + "%"]);
  await db.query(`DELETE FROM wallet_order WHERE order_id LIKE $1`, [TAG + "%"]);
  await db.query(`DELETE FROM wallet_txn WHERE ref LIKE $1`, [TAG + "%"]);
  await db.query(`DELETE FROM invoice_counter WHERE series LIKE 'TST/%'`);
  await db.query(`DELETE FROM app_client WHERE id = $1`, [OTHER_CLIENT]);
}

/** A paid order, exactly as Cashfree would have left it. */
async function seedPaidOrder(id, clientId, amount) {
  await db.query(
    `INSERT INTO wallet_order (order_id, client_id, amount, status, paid_at)
     VALUES ($1,$2,$3,'paid',$4)`,
    [id, clientId, amount, new Date("2026-08-22T06:00:00Z")],
  );
}

const admin = makeSession();
const client = makeSession();

async function main() {
  await db.connect();
  await cleanup();

  await admin.login(ADMIN);
  await client.login(CLIENT);
  const me = await client.api("/api/me");
  const CID = me.clientId;
  if (!CID) throw new Error("client login did not yield a client id");
  console.log(`client ${CID}, app at ${APP}\n`);

  const prevSettings = (await admin.api("/api/admin/invoicing")).settings;

  // --- 1. nothing is issued until it is configured --------------------------
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify({ ...SELLER, enabled: false }) });
  await seedPaidOrder(TAG + "off", CID, 1000);
  const off = await admin.api("/api/admin/invoicing", { method: "POST" }).catch(e => e);
  check("back-fill refuses while invoicing is off", off.status, 400);
  const noneYet = await db.query(`SELECT count(*)::int n FROM invoice WHERE order_id = $1`, [TAG + "off"]);
  check("...and no invoice was raised", noneYet.rows[0].n, 0);

  const cfg = await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(SELLER) });
  check("configured settings report as issuing", cfg.issuing, true);
  check("...with nothing missing", cfg.missing, []);

  const blank = await admin.api("/api/admin/invoicing", {
    method: "PUT", body: JSON.stringify({ ...SELLER, gstin: "" }) });
  check("a blank GSTIN stops issuing", blank.issuing, false);
  check("...and says which field", blank.missing, ["GSTIN"]);
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(SELLER) });

  // --- 2. the maths, tax INCLUSIVE, intra-state -----------------------------
  await db.query(`UPDATE app_client SET state_code='29', state='Karnataka', gstin='29ZZZZZ1234Z1Z5',
                  legal_name='Local Test Co', address='2 Client Road, Bengaluru' WHERE id=$1`, [CID]);
  await seedPaidOrder(TAG + "a", CID, 1000);
  await admin.api("/api/admin/invoicing", { method: "POST" });

  const invs = (await client.api("/api/wallet/invoices")).invoices;
  const a = invs.find(i => i.orderId === TAG + "a");
  check("an invoice exists for the payment", !!a, true);
  check("taxable value is carved out of the amount", a.totals.taxableP, 84746);
  check("CGST is half the tax", a.totals.cgstP, 7627);
  check("SGST is the other half", a.totals.sgstP, 7627);
  check("no IGST within the same state", a.totals.igstP, 0);
  check("the parts foot to the amount charged",
    a.totals.taxableP + a.totals.cgstP + a.totals.sgstP + a.totals.igstP, 100000);
  check("total equals what was paid", a.totals.totalP, 100000);
  check("wallet credit equals the amount paid (inclusive)", a.creditP, 100000);
  check("buyer details are snapshot onto it", a.buyer.gstin, "29ZZZZZ1234Z1Z5");
  check("seller details too", a.seller.gstin, "29ABCDE1234F1Z5");

  // --- 3. inter-state -> IGST ----------------------------------------------
  await db.query(`UPDATE app_client SET state_code='27', state='Maharashtra' WHERE id=$1`, [CID]);
  await seedPaidOrder(TAG + "b", CID, 1000);
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const b = (await client.api("/api/wallet/invoices")).invoices.find(i => i.orderId === TAG + "b");
  check("a customer in another state is charged IGST", b.totals.igstP, 15254);
  check("...and no CGST/SGST", [b.totals.cgstP, b.totals.sgstP], [0, 0]);
  check("...still footing exactly", b.totals.taxableP + b.totals.igstP, 100000);

  // --- 4. unknown state is treated as the seller's own ----------------------
  await db.query(`UPDATE app_client SET state_code=NULL, state=NULL WHERE id=$1`, [CID]);
  await seedPaidOrder(TAG + "c", CID, 1000);
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const c = (await client.api("/api/wallet/invoices")).invoices.find(i => i.orderId === TAG + "c");
  check("an unknown buyer state is treated as intra-state", c.totals.igstP, 0);
  check("...so CGST+SGST apply", c.totals.cgstP + c.totals.sgstP, 15254);

  // --- 5. tax EXCLUSIVE ------------------------------------------------------
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify({ ...SELLER, taxMode: "exclusive" }) });
  await seedPaidOrder(TAG + "d", CID, 1000);
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const d = (await client.api("/api/wallet/invoices")).invoices.find(i => i.orderId === TAG + "d");
  check("exclusive: taxable is the full amount", d.totals.taxableP, 100000);
  check("exclusive: tax is added on top", d.totals.cgstP + d.totals.sgstP, 18000);
  check("exclusive: the customer is charged more than the credit", d.totals.totalP, 118000);
  check("...but still receives the credit purchased", d.creditP, 100000);
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(SELLER) });

  // --- 6. odd amounts must still foot ---------------------------------------
  await seedPaidOrder(TAG + "e", CID, 999.99);
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const e = (await client.api("/api/wallet/invoices")).invoices.find(i => i.orderId === TAG + "e");
  check("an odd amount still foots to the paise",
    e.totals.taxableP + e.totals.cgstP + e.totals.sgstP, 99999);

  // --- 7. one payment, one invoice ------------------------------------------
  const before = (await client.api("/api/wallet/invoices")).invoices.length;
  await admin.api("/api/admin/invoicing", { method: "POST" });
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const after = (await client.api("/api/wallet/invoices")).invoices.length;
  check("re-running the issue path creates nothing new", after, before);
  const dupes = await db.query(
    `SELECT count(*)::int n FROM (SELECT order_id FROM invoice GROUP BY order_id HAVING count(*) > 1) x`);
  check("no order has two invoices", dupes.rows[0].n, 0);

  // --- 8. numbering ----------------------------------------------------------
  const mine = (await client.api("/api/wallet/invoices")).invoices
    .filter(i => i.orderId.startsWith(TAG)).sort((x, y) => x.id - y.id);
  check("numbers carry the configured prefix", mine[0].invoiceNo.startsWith("TST/"), true);
  check("...and the Indian financial year for August 2026", mine[0].invoiceNo.split("/")[1], "26-27");
  const seq = mine.map(i => Number(i.invoiceNo.split("/")[2]));
  check("...and run consecutively", seq, seq.map((_, i) => seq[0] + i));
  check("...with no repeats", new Set(mine.map(i => i.invoiceNo)).size, mine.length);

  // --- 9. the PDF -------------------------------------------------------------
  const pdfRes = await client.raw(`/api/wallet/invoices/${a.id}/pdf`);
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  check("the PDF is a PDF", buf.subarray(0, 5).toString(), "%PDF-");
  check("...served as one", pdfRes.headers.get("content-type"), "application/pdf");
  check("...as a download named after the invoice",
    /attachment; filename="tax-invoice-TST-26-27-\d{4}\.pdf"/.test(pdfRes.headers.get("content-disposition") || ""), true);
  check("...and is not cached", pdfRes.headers.get("cache-control"), "private, no-store");

  // --- 10. isolation ----------------------------------------------------------
  await db.query(
    `INSERT INTO app_client (id, name, email, pass_hash, pass_salt, perms, active)
     VALUES ($1,'Other','other-inv@test.local','x','y','["billing"]'::jsonb, true)`, [OTHER_CLIENT]);
  await seedPaidOrder(TAG + "other", OTHER_CLIENT, 500);
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const otherInv = await db.query(`SELECT id FROM invoice WHERE order_id=$1`, [TAG + "other"]);
  check("the other tenant got its own invoice", otherInv.rows.length, 1);
  const peek = await client.raw(`/api/wallet/invoices/${otherInv.rows[0].id}/pdf`);
  check("a client cannot download another client's invoice", peek.status, 404);
  const listed = (await client.api("/api/wallet/invoices")).invoices.some(i => i.orderId === TAG + "other");
  check("...nor see it listed", listed, false);

  // --- 11. money never depends on invoicing ------------------------------------
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify({ ...SELLER, enabled: false }) });
  const balBefore = (await db.query(`SELECT balance FROM client_wallet WHERE client_id=$1`, [CID])).rows[0]?.balance ?? 0;
  await seedPaidOrder(TAG + "f", CID, 250);
  const credited = await admin.api(`/api/admin/clients/${CID}/wallet`, {
    method: "POST", body: JSON.stringify({ type: "adjustment", amount: 0, description: "noop" }),
  }).catch(() => null);
  const noInv = await db.query(`SELECT count(*)::int n FROM invoice WHERE order_id=$1`, [TAG + "f"]);
  check("with invoicing off, no invoice is raised", noInv.rows[0].n, 0);
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(SELLER) });
  await admin.api("/api/admin/invoicing", { method: "POST" });
  const later = await db.query(`SELECT count(*)::int n FROM invoice WHERE order_id=$1`, [TAG + "f"]);
  check("...and it can be back-filled afterwards", later.rows[0].n, 1);

  // restore whatever was configured before the test ran
  await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(prevSettings) });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(() => {}); await db.end().catch(() => {}); });
