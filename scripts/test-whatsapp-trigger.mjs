/**
 * WhatsApp trigger test.
 *
 * The message used to go out only when a lead pressed 1. A campaign can now
 * send it the moment the call is picked up instead, and press-1 keeps working
 * either way. The thing that must never happen is a lead getting TWO messages
 * because they answered and then pressed 1.
 *
 * This drives the two Plivo webhooks (/api/answer and /api/dtmf) directly and
 * counts what arrives at a fixture webhook receiver standing in for Pabbly.
 * No calls are placed and no real webhook is touched — the campaign points at
 * the fixture, and the call records are written straight into the store the way
 * a placed call would have written them.
 *
 * Usage (local sandbox DB running, app on :3000):
 *   1. npm run dev
 *   2. node scripts/test-whatsapp-trigger.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP   = process.env.APP_URL || "http://localhost:3000";
const PORT  = Number(process.env.FIXTURE_PORT || 4603);
const EMAIL = process.env.TEST_EMAIL || "test@local";
const PASS  = process.env.TEST_PASSWORD || "testlocal";

// --- fixture Pabbly ---------------------------------------------------------

/** Every webhook POST the app made, in order. */
let received = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    try { received.push(JSON.parse(body)); } catch { received.push({ unparsed: body }); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});

const WEBHOOK = `http://127.0.0.1:${PORT}/pabbly`;

/** The send is deliberately not awaited by the answer webhook, so give it a moment. */
async function settle(ms = 1500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

// --- tiny test harness ------------------------------------------------------

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

// --- app helpers ------------------------------------------------------------

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

/** Hit a Plivo webhook the way Plivo would (unsigned; VERIFY_PLIVO_SIG is off locally). */
async function plivo(pathname, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${APP}${pathname}?${qs}`);
  return res.text();
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
let clientId = "";
const madeCampaigns = [];
const madeKeys = [];

/** Write the call record a placed call would have written, so we can drive the webhooks. */
async function seedCall(id, campaign, phone) {
  const key = `t:${clientId}:call:${id}`;
  const record = {
    callUuid: id,
    campaignId: campaign.id,
    campaignName: campaign.name,
    to: phone,
    from: "+911111111111",
    audioId: campaign.audioId ?? null,
    webhookUrl: campaign.webhookUrl,
    status: "triggered",
    digit: "",
    triggeredAt: new Date().toISOString(),
  };
  await db.query(
    "INSERT INTO kv (k, v) VALUES ($1, $2::jsonb) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
    [key, JSON.stringify(record)],
  );
  madeKeys.push(key);
  return id;
}

async function callRecord(id) {
  const { rows } = await db.query("SELECT v FROM kv WHERE k = $1", [`t:${clientId}:call:${id}`]);
  return rows.length ? rows[0].v : null;
}

async function makeCampaign(name, whatsappTrigger) {
  const { campaign } = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: `${name}-${Date.now()}`, webhookUrl: WEBHOOK, whatsappTrigger }),
  });
  madeCampaigns.push(campaign.id);
  return campaign;
}

// --- the test ---------------------------------------------------------------

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  await db.connect();
  console.log("fixture Pabbly on :" + PORT + ", app at " + APP + "\n");

  await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const me = await api("/api/me");
  clientId = me.client?.id || me.clientId || me.id || "";
  if (!clientId) throw new Error("could not determine client id from /api/me: " + JSON.stringify(me));

  try {
    // 1. Send-on-answer: picking up is enough.
    const onAnswer = await makeCampaign("wa-answer", "answer");
    check("new campaign stores the answer trigger", onAnswer.whatsappTrigger, "answer");

    received = [];
    const c1 = await seedCall("test-answer-1", onAnswer, "+919812000001");
    await plivo(`/api/answer/${onAnswer.id}`, { req: c1, client: clientId, CallUUID: c1 });
    await settle();
    check("one message on pickup", received.length, 1);
    check("...marked as an answer", received[0]?.event, "answered");
    check("...to the right lead", received[0]?.to, "+919812000001");
    check("...with no digit", received[0]?.digit, "");

    // 2. The same lead then presses 1 — they must NOT be messaged twice.
    await plivo("/api/dtmf", { req: c1, client: clientId, Digits: "1", CallUUID: c1 });
    await settle(600);
    check("pressing 1 afterwards sends nothing more", received.length, 1);
    check("but the press is still recorded", (await callRecord(c1))?.status, "press1");

    // 3. A repeated answer callback from Plivo must not send twice either.
    received = [];
    const c2 = await seedCall("test-answer-2", onAnswer, "+919812000002");
    await plivo(`/api/answer/${onAnswer.id}`, { req: c2, client: clientId, CallUUID: c2 });
    await plivo(`/api/answer/${onAnswer.id}`, { req: c2, client: clientId, CallUUID: c2 });
    await settle();
    check("a duplicate answer callback sends once", received.length, 1);

    // 4. Press-1 campaigns are untouched: answering alone sends nothing.
    const onPress = await makeCampaign("wa-press", "press1");
    received = [];
    const c3 = await seedCall("test-press-1", onPress, "+919812000003");
    await plivo(`/api/answer/${onPress.id}`, { req: c3, client: clientId, CallUUID: c3 });
    await settle();
    check("press-1 campaign: answering sends nothing", received.length, 0);

    await plivo("/api/dtmf", { req: c3, client: clientId, Digits: "1", CallUUID: c3 });
    await settle();
    check("press-1 campaign: pressing 1 sends it", received.length, 1);
    check("...marked as a press", received[0]?.event, "press1");
    check("...carrying the digit, as before", received[0]?.digit, "1");

    // 5. A campaign saved before this setting existed has no value at all, and
    //    must keep behaving exactly as it did: press-1 only.
    const legacy = await makeCampaign("wa-legacy", "press1");
    await db.query(
      `UPDATE kv SET v = v - 'whatsappTrigger' WHERE k = $1`,
      [`t:${clientId}:campaign:${legacy.id}`],
    );
    const stored = await db.query("SELECT v FROM kv WHERE k = $1", [`t:${clientId}:campaign:${legacy.id}`]);
    check("legacy campaign really has no setting", stored.rows[0]?.v?.whatsappTrigger, undefined);

    received = [];
    const c4 = await seedCall("test-legacy-1", legacy, "+919812000004");
    await plivo(`/api/answer/${legacy.id}`, { req: c4, client: clientId, CallUUID: c4 });
    await settle();
    check("legacy campaign: answering sends nothing", received.length, 0);

    await plivo("/api/dtmf", { req: c4, client: clientId, Digits: "1", CallUUID: c4 });
    await settle();
    check("legacy campaign: press 1 still sends", received.length, 1);

    // 6. Switching an existing campaign over takes effect.
    await api(`/api/campaigns/${legacy.id}`, {
      method: "PATCH",
      body: JSON.stringify({ whatsappTrigger: "answer" }),
    });
    received = [];
    const c5 = await seedCall("test-legacy-2", legacy, "+919812000005");
    await plivo(`/api/answer/${legacy.id}`, { req: c5, client: clientId, CallUUID: c5 });
    await settle();
    check("after switching, answering sends it", received.length, 1);
  } finally {
    for (const id of madeCampaigns) {
      await api(`/api/campaigns/${id}`, { method: "DELETE" }).catch(() => {});
    }
    for (const k of madeKeys) {
      await db.query("DELETE FROM kv WHERE k = $1", [k]).catch(() => {});
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
