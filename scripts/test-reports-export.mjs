/**
 * Call reports: date range -> campaigns that ran in it -> one or many
 * campaigns -> one-row-per-call CSV.
 *
 * Seeds call records for three fresh campaigns on three consecutive days far in
 * the past (a random base day per run, so earlier runs never collide), writing
 * exactly the rows recordCall() + the stats counters write, then checks:
 *   - /api/reports/campaigns lists only campaigns with calls in the range, with counts
 *   - /api/reports KPIs for one / many campaigns, and its campaignsInRange list
 *   - /api/reports/csv row counts for one / many / all campaigns, header order,
 *     UTF-8 BOM, file name, and the old single `campaign=` param
 *
 * Needs the isolated test app (never the main `ivr` sandbox with workers on):
 *   PGDATABASE=ivr_cs npx next start -p 3100
 *   APP_URL=http://127.0.0.1:3100 TEST_DB=ivr_cs node scripts/test-reports-export.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://127.0.0.1:3100";
const DB = process.env.TEST_DB || "ivr_cs";
const CLIENT = { email: "test@local", password: "testlocal" };

const COLUMNS = ["Call ID", "Date", "Time (IST)", "Campaign", "Phone", "Name", "Email", "Call status", "Answered",
  "Duration (sec)", "Duration", "Key pressed", "Pressed 1", "WhatsApp sent", "Hang-up reason", "Caller ID", "Source", "Cost (₹)"];

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  PASS  " + label); }
  else { failed++; console.log("  FAIL  " + label + "\n        expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)); }
}

let cookie = "";
async function api(pathname, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(APP + pathname, { ...init, headers, redirect: "manual" });
  const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
/** CSV fetch that keeps the raw bytes (Response.text() would strip the BOM). */
async function csv(qs) {
  const res = await fetch(`${APP}/api/reports/csv?${qs}`, { headers: { cookie }, redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const rows = parseCsv(text);
  const disp = res.headers.get("content-disposition") || "";
  return { status: res.status, bom, header: rows[0] || [], rows: rows.slice(1), filename: (disp.match(/filename="([^"]+)"/) || [])[1] || "" };
}
function parseCsv(text) {
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.length > 1 || r[0]);
}

function dbConfig() {
  const env = {}; const file = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
  return { host: env.PGHOST || "127.0.0.1", port: Number(env.PGPORT || 5432), user: env.PGUSER || "postgres", password: env.PGPASSWORD || undefined, database: DB };
}

const IST_SHIFT = (5 * 60 + 30) * 60 * 1000;
const addDays = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

async function main() {
  const db = new pg.Client(dbConfig()); await db.connect();
  check("client login", (await api("/api/auth/login", { method: "POST", body: JSON.stringify(CLIENT) })).status, 200);
  const cid = (await api("/api/me")).body.clientId;
  const tag = Date.now().toString(36);
  const P = `t:${cid}:`;

  // Three fresh campaigns.
  const mkCampaign = async (name) => {
    const r = await api("/api/campaigns", { method: "POST", body: JSON.stringify({ name, whatsappTrigger: "never" }) });
    check(`create campaign ${name}`, r.status, 201);
    return r.body.campaign;
  };
  const A = await mkCampaign(`Rep A ${tag}`);
  const B = await mkCampaign(`Rep B ${tag}`);
  const C = await mkCampaign(`Rep C ${tag}`);

  // A random day between 2001 and ~2009 so runs never overlap each other.
  const d0 = addDays("2001-01-01", Math.floor(Math.random() * 3000));
  const d1 = addDays(d0, 1), d2 = addDays(d0, 2);

  const hincr = (k, field, by) => db.query(
    `INSERT INTO hash (k, field, v) VALUES ($1, $2, $3::text)
     ON CONFLICT (k, field) DO UPDATE SET v = ((COALESCE(NULLIF(hash.v,'')::numeric, 0) + $3::numeric))::text`,
    [k, field, String(by)]);
  const zadd = (k, member, score) => db.query(
    `INSERT INTO zset (k, member, score) VALUES ($1, $2, $3) ON CONFLICT (k, member) DO UPDATE SET score = EXCLUDED.score`,
    [k, member, score]);

  /**
   * One call, written the way recordCall() + recordPlaced/Answered/Press1/Finalized do:
   *   kv    t:<cid>:call:<id>
   *   zset  t:<cid>:calls:zall, calls:byday:<UTC day of triggeredAt>, calls:bycampaign:<campaign>
   *   hash  t:<cid>:stats:d:<IST day>, stats:dc:<IST day>:<campaign>
   */
  let seq = 0;
  const seeded = [];
  const mkCall = async (campaign, day, hhmm, kind) => {
    const id = `rx-${tag}-${++seq}`;
    const triggeredAt = new Date(Date.parse(`${day}T${hhmm}:00.000+05:30`)).toISOString();
    const score = Date.parse(triggeredAt);
    const hour = hhmm.slice(0, 2);
    const to = `+9190000${String(70000 + seq).slice(-5)}`;
    const rec = {
      callUuid: id, campaignId: campaign.id, campaignName: campaign.name, to, from: "+918000000000",
      audioId: null, webhookUrl: "", status: "hangup", digit: "", triggeredAt, name: `Lead ${seq}`, email: `lead${seq}@example.test`,
    };
    let outcome = "no-answer";
    if (kind === "press1") { Object.assign(rec, { status: "press1", digit: "1", answeredAt: triggeredAt, hangupAt: triggeredAt, durationSec: 65, hangupCause: "NORMAL_CLEARING" }); outcome = "press1"; }
    else if (kind === "answered") { Object.assign(rec, { answeredAt: triggeredAt, hangupAt: triggeredAt, durationSec: 20, hangupCause: "NORMAL_CLEARING" }); outcome = "connected"; }
    else if (kind === "busy") { Object.assign(rec, { hangupAt: triggeredAt, durationSec: 0, hangupCause: "USER_BUSY" }); outcome = "busy"; }
    else { Object.assign(rec, { hangupAt: triggeredAt, durationSec: 0, hangupCause: "NO_ANSWER" }); }

    await db.query(`INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [`${P}call:${id}`, rec]);
    await zadd(`${P}calls:zall`, id, score);
    await zadd(`${P}calls:byday:${triggeredAt.slice(0, 10)}`, id, score);
    await zadd(`${P}calls:bycampaign:${campaign.id}`, id, score);
    const istDay = new Date(score + IST_SHIFT).toISOString().slice(0, 10);
    for (const k of [`${P}stats:d:${istDay}`, `${P}stats:dc:${istDay}:${campaign.id}`]) {
      await hincr(k, "total", 1);
      await hincr(k, `h_${hour}`, 1);
      if (rec.answeredAt) await hincr(k, "answered", 1);
      if (rec.digit === "1") await hincr(k, "press1", 1);
      await hincr(k, `o_${outcome}`, 1);
      if (rec.durationSec > 0) await hincr(k, "durSum", rec.durationSec);
    }
    await hincr(`${P}stats:d:${istDay}`, `c_${campaign.id}`, 1);
    seeded.push(rec);
    return rec;
  };

  // A: 3 on d0 + 2 on d1 = 5   B: 4 on d1   C: 2 on d2   (11 in all)
  const aPress = await mkCall(A, d0, "09:05", "press1");
  await mkCall(A, d0, "10:15", "answered");
  await mkCall(A, d0, "23:40", "noanswer"); // late evening IST: must stay on d0, not roll to the next UTC day
  await mkCall(A, d1, "11:00", "busy");
  await mkCall(A, d1, "12:00", "answered");
  for (const t of ["08:00", "09:00", "10:00", "11:30"]) await mkCall(B, d1, t, t === "08:00" ? "press1" : "noanswer");
  await mkCall(C, d2, "14:00", "answered");
  await mkCall(C, d2, "15:00", "noanswer");

  // A real wallet charge for the press-1 call (ref = call id, like the hangup route).
  const txn = await db.query(
    `INSERT INTO wallet_txn (client_id, type, amount, balance_after, description, ref)
     VALUES ($1, 'charge', -0.45, 0, 'test-reports-export', $2) RETURNING id`, [cid, aPress.callUuid]);

  try {
    console.log("\n1. campaigns that ran in a range");
    const r01 = await api(`/api/reports/campaigns?from=${d0}&to=${d1}`);
    check("listing responds", r01.status, 200);
    const mine = (list) => list.filter((c) => [A.id, B.id, C.id].includes(c.id)).map((c) => [c.name, c.calls]);
    check(`${d0}..${d1}: only A and B, with counts, most calls first`, mine(r01.body.campaigns), [[A.name, 5], [B.name, 4]]);
    const r22 = await api(`/api/reports/campaigns?from=${d2}&to=${d2}`);
    check(`${d2}: only C`, mine(r22.body.campaigns), [[C.name, 2]]);
    const r02 = await api(`/api/reports/campaigns?from=${d0}&to=${d2}`);
    check(`${d0}..${d2}: all three`, mine(r02.body.campaigns), [[A.name, 5], [B.name, 4], [C.name, 2]]);
    check("a range with no calls lists nothing of ours", mine((await api(`/api/reports/campaigns?from=${addDays(d0, -5)}&to=${addDays(d0, -4)}`)).body.campaigns), []);

    console.log("\n2. report data for one / many campaigns");
    const rep = (qs) => api(`/api/reports?from=${d0}&to=${d2}&${qs}`);
    const one = await rep(`campaigns=${A.id}`);
    check("one campaign: 5 calls", one.body.totals?.total, 5);
    check("one campaign: 3 answered, 1 pressed 1", [one.body.totals?.answered, one.body.totals?.press1], [3, 1]);
    check("one campaign: spent = the charge on its call", one.body.totals?.spent, 0.45);
    const many = await rep(`campaigns=${A.id},${B.id}`);
    check("A + B: 9 calls", many.body.totals?.total, 9);
    check("A + B: by-campaign table has both", (many.body.campaignTable || []).map((r) => [r.campaignId, r.total]), [[A.id, 5], [B.id, 4]]);
    check("A + B: picker still lists all three ran in range", mine(many.body.campaignsInRange || []).length, 3);
    check("A + B: latest calls only from A and B", (many.body.recent || []).every((c) => c.campaignId === A.id || c.campaignId === B.id), true);
    check("old single campaign= param still filters", (await rep(`campaign=${B.id}`)).body.totals?.total, 4);
    check("all campaigns: 11 calls in this range", (await rep("")).body.totals?.total, 11);

    console.log("\n3. CSV export");
    const base = `from=${d0}&to=${d2}`;
    const ca = await csv(`${base}&campaigns=${A.id}`);
    check("csv responds 200", ca.status, 200);
    check("starts with a UTF-8 BOM", ca.bom, true);
    check("header columns, in order", ca.header, COLUMNS);
    check("one campaign: 5 rows", ca.rows.length, 5);
    check("one campaign file name", ca.filename, `call-report_${d0}_to_${d2}_rep-a-${tag}.csv`);
    const row = Object.fromEntries(COLUMNS.map((c, i) => [c, ca.rows.find((r) => r[0] === aPress.callUuid)?.[i]]));
    check("press-1 row: date + IST time", [row["Date"], row["Time (IST)"]], [d0, "09:05:00"]);
    check("press-1 row: campaign, phone, name, email", [row["Campaign"], row["Phone"], row["Name"], row["Email"]], [A.name, aPress.to, aPress.name, aPress.email]);
    check("press-1 row: status / answered / pressed 1", [row["Call status"], row["Answered"], row["Key pressed"], row["Pressed 1"]], ["Answered", "Yes", "1", "Yes"]);
    check("press-1 row: duration", [row["Duration (sec)"], row["Duration"]], ["65", "1:05"]);
    check("press-1 row: hang-up reason, caller ID, source", [row["Hang-up reason"], row["Caller ID"], row["Source"]], ["Call ended normally", "+918000000000", "Dial / API"]);
    check("press-1 row: cost from the wallet charge", row["Cost (₹)"], "0.45");
    const late = ca.rows.find((r) => r[2] === "23:40:00");
    check("23:40 IST call stays on its IST date", late?.[1], d0);
    check("unanswered call: cost 0.00 (never billed)", late?.[17], "0.00");

    const cab = await csv(`${base}&campaigns=${A.id},${B.id}`);
    check("A + B: 9 rows", cab.rows.length, 9);
    check("A + B file name", cab.filename, `call-report_${d0}_to_${d2}_2-campaigns.csv`);
    check("A + B: newest first", cab.rows.map((r) => r[1] + " " + r[2]).join("|"), cab.rows.map((r) => r[1] + " " + r[2]).sort().reverse().join("|"));
    const repeated = await csv(`${base}&campaigns=${A.id}&campaigns=${B.id}&campaign=${A.id}`);
    check("repeated / mixed params are de-duplicated", repeated.rows.length, 9);
    const old = await csv(`${base}&campaign=${C.id}`);
    check("old campaign= param: 2 rows", old.rows.length, 2);
    check("old campaign= param: same header", old.header, COLUMNS);
    check("A + C on d0..d1: only A's 5 (C ran later)", (await csv(`from=${d0}&to=${d1}&campaigns=${A.id},${C.id}`)).rows.length, 5);
    const all = await csv(base);
    check("no campaign = all campaigns: 11 rows", all.rows.length, 11);
    check("all campaigns file name", all.filename, `call-report_${d0}_to_${d2}_all-campaigns.csv`);
    check("single day= still works", (await csv(`day=${d1}&campaigns=${B.id}`)).rows.length, 4);
    const empty = await csv(`from=${addDays(d0, -5)}&to=${addDays(d0, -4)}&campaigns=${A.id}`);
    check("empty range: header only", [empty.status, empty.header.length, empty.rows.length], [200, COLUMNS.length, 0]);
  } finally {
    await db.query(`DELETE FROM wallet_txn WHERE id = $1`, [txn.rows[0].id]);
    await db.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
