/**
 * "Don't send" campaigns (whatsappTrigger = "never") must send no WhatsApp on
 * press 1 — whether the call was placed while the campaign was already set to
 * "never" (flag on the call) or the campaign was switched after the call went
 * out (live re-check). A normal press-1 campaign is the control: it must send.
 *
 * Needs the isolated test app (never the main `ivr` sandbox with workers on):
 *   PGDATABASE=ivr_cs WORKER_DISABLED=0 PLIVO_AUTH_ID= PLIVO_AUTH_TOKEN= PLIVO_FROM_NUMBER= \
 *     PABBLY_WEBHOOK_URL=http://127.0.0.1:4621/hook npx next start -p 3100
 *   APP_URL=http://127.0.0.1:3100 TEST_DB=ivr_cs node scripts/test-campaign-never.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://127.0.0.1:3100";
const DB = process.env.TEST_DB || "ivr_cs";
const HOOK_PORT = 4621;
const HOOK = `http://127.0.0.1:${HOOK_PORT}/hook`;
const CLIENT = { email: "test@local", password: "testlocal" };

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  PASS  " + label); }
  else { failed++; console.log("  FAIL  " + label + "\n        expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const received = [];
const hookServer = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => { try { received.push(JSON.parse(body)); } catch { received.push({ raw: body }); } res.writeHead(200); res.end("{}"); });
});
const hits = (num) => received.filter((p) => JSON.stringify(p).includes(num.replace(/\D/g, "").slice(-10))).length;

function session() {
  let cookie = "";
  return async (pathname, init = {}) => {
    const headers = { "content-type": "application/json", ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(APP + pathname, { ...init, headers, redirect: "manual" });
    const sc = res.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    const text = await res.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
}
function dbConfig() {
  const env = {}; const file = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
  return { host: env.PGHOST || "127.0.0.1", port: Number(env.PGPORT || 5432), user: env.PGUSER || "postgres", password: env.PGPASSWORD || undefined, database: DB };
}

async function main() {
  await new Promise((r) => hookServer.listen(HOOK_PORT, "127.0.0.1", r));
  const db = new pg.Client(dbConfig()); await db.connect();
  const s = session();
  check("client login", (await s("/api/auth/login", { method: "POST", body: JSON.stringify(CLIENT) })).status, 200);
  const cid = (await s("/api/me")).body.clientId;
  const tag = Date.now().toString(36);

  console.log("\n1. the setting saves");
  const never = await s("/api/campaigns", { method: "POST", body: JSON.stringify({ name: `never-${tag}`, webhookUrl: HOOK, whatsappTrigger: "never" }) });
  check("create a Don't send campaign", never.status, 201);
  check("...stored as 'never'", never.body.campaign?.whatsappTrigger, "never");
  const press = await s("/api/campaigns", { method: "POST", body: JSON.stringify({ name: `press-${tag}`, webhookUrl: HOOK, whatsappTrigger: "press1" }) });
  const later = await s("/api/campaigns", { method: "POST", body: JSON.stringify({ name: `later-${tag}`, webhookUrl: HOOK, whatsappTrigger: "press1" }) });
  const list = (await s("/api/campaigns")).body.campaigns;
  check("reads back as 'never' in the list", list.find((c) => c.id === never.body.campaign.id)?.whatsappTrigger, "never");
  const junk = await s("/api/campaigns", { method: "POST", body: JSON.stringify({ name: `junk-${tag}`, whatsappTrigger: "nevr" }) });
  check("a typo still falls back to press 1, not 'never'", junk.body.campaign?.whatsappTrigger, "press1");

  // Call records exactly as placeCampaignCall writes them (Plivo is off here).
  const mk = async (id, campaign, to, extra = {}) => {
    const rec = { callUuid: id, campaignId: campaign.id, campaignName: campaign.name, to, from: "+918000000000", audioId: null,
      webhookUrl: HOOK, status: "answered", digit: "", triggeredAt: new Date().toISOString(), ...extra };
    await db.query(`INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [`t:${cid}:call:${id}`, rec]);
  };
  const press1 = (id) => s(`/api/dtmf?req=${id}&client=${cid}&Digits=1`, { method: "GET" });

  console.log("\n2. press 1 on a Don't send campaign");
  await mk(`nv1-${tag}`, never.body.campaign, "+919000000501", { noWhatsapp: true });
  check("press 1 is accepted", (await press1(`nv1-${tag}`)).status, 200);
  await mk(`ctl-${tag}`, press.body.campaign, "+919000000502");
  await press1(`ctl-${tag}`);
  await mk(`sw-${tag}`, later.body.campaign, "+919000000503");
  check("switch a campaign to Don't send while its call is live", (await s(`/api/campaigns/${later.body.campaign.id}`, { method: "PATCH", body: JSON.stringify({ whatsappTrigger: "never" }) })).status, 200);
  await press1(`sw-${tag}`);
  await sleep(2500);
  check("Don't send campaign: nothing sent", hits("+919000000501"), 0);
  check("switched to Don't send mid-call: nothing sent", hits("+919000000503"), 0);
  check("normal press-1 campaign (control): sent once", hits("+919000000502"), 1);
  const rec = (await db.query(`SELECT v FROM kv WHERE k = $1`, [`t:${cid}:call:nv1-${tag}`])).rows[0]?.v;
  check("press 1 is still counted on the call", rec?.status, "press1");
  check("...and no send is recorded", rec?.whatsappSentAt ?? null, null);

  await db.end(); hookServer.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
