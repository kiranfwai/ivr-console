/**
 * Scheduling test — campaigns and WhatsApp sends that start by themselves.
 *
 * What has to be true, and none of it is obvious:
 *   - "7pm" means 7pm in India, whatever the server's clock is set to;
 *   - a weekly rule lands on the chosen weekday, a daily one on the next day;
 *   - a one-off fires once and then stands down, rather than sitting armed with
 *     a time in the past and firing forever;
 *   - a repeating one advances and stays armed;
 *   - a run claimed by one poller cannot be claimed by another — firing the same
 *     schedule twice means calling or messaging everybody twice;
 *   - pausing and resuming must not fire the missed run immediately on resume;
 *   - scheduling cannot be used to do something the user lacks permission for;
 *   - one client can never see or touch another's schedules.
 *
 * Usage (local sandbox DB running):
 *   1. npm run dev
 *   2. node scripts/test-schedule.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const APP = process.env.APP_URL || "http://localhost:3000";
const ADMIN = { email: "admin@local", password: "localdev" };
const CLIENT = { email: "test@local", password: "testlocal" };
const TAG = "sched-test-";
const OTHER_CLIENT = "cli_sched_other";

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
      if (!res.ok) { const e = new Error(`${init.method || "GET"} ${p} -> ${res.status} ${t.slice(0,140)}`); e.status = res.status; e.body = b; throw e; }
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

const admin = makeSession(), client = makeSession();
const RECIPIENTS = [{ phone: "+919700000101", name: "A" }, { phone: "+919700000102", name: "B" }];

/** IST wall-clock helpers, mirroring the server's. */
const istDate = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const istDay = (d) => new Date(d.getTime() + 330 * 60000).getUTCDay();

async function cleanup() {
  await db.query(`DELETE FROM schedule WHERE name LIKE $1`, [TAG + "%"]);
  const { rows } = await db.query(`SELECT id FROM bulk_job WHERE client_id = $1 OR client_id = $2`,
    [OTHER_CLIENT, "__none__"]);
  for (const r of rows) await db.query(`DELETE FROM bulk_job WHERE id = $1`, [r.id]);
  await db.query(`DELETE FROM app_client WHERE id = $1`, [OTHER_CLIENT]);
}

async function main() {
  await db.connect();
  await cleanup();
  await admin.login(ADMIN);
  await client.login(CLIENT);
  const me = await client.api("/api/me");
  const CID = me.clientId;
  console.log(`client ${CID}, app at ${APP}\n`);

  // A campaign to point call schedules at.
  const camps = await client.api("/api/campaigns");
  const campaignId = (camps.campaigns || camps)?.[0]?.id;
  if (!campaignId) throw new Error("no campaign in the sandbox to schedule against");

  const mk = (over = {}) => ({
    name: TAG + "once",
    kind: "whatsapp",
    repeat: "once",
    startAt: new Date(Date.now() + 3600_000).toISOString(),
    spec: { webhookUrl: "https://example.invalid/hook", recipients: RECIPIENTS, concurrency: 5, delayMs: 1000 },
    ...over,
  });

  // --- 1. validation --------------------------------------------------------
  const bad = (body) => client.api("/api/schedules", { method: "POST", body: JSON.stringify(body) })
    .then(() => null).catch((e) => e.body?.error);
  check("a schedule needs a name", await bad(mk({ name: "" })), "Give the schedule a name");
  check("...and recipients", await bad(mk({ spec: { recipients: [] } })), "Add at least one recipient");
  check("...a time in the future", await bad(mk({ startAt: new Date(Date.now() - 60000).toISOString() })),
    "That time has already passed");
  check("a call schedule needs a campaign", await bad(mk({ kind: "call", spec: { recipients: RECIPIENTS } })),
    "Choose a campaign");
  check("a weekly schedule needs at least one day",
    await bad(mk({ repeat: "weekly", atTime: "19:00", days: [] })), "Choose at least one day");
  check("...and a valid time", await bad(mk({ repeat: "daily", atTime: "25:00" })), "Choose a time of day");

  // --- 2. the time maths, in IST -------------------------------------------
  const daily = (await client.api("/api/schedules", {
    method: "POST", body: JSON.stringify(mk({ name: TAG + "daily", repeat: "daily", atTime: "19:00", startAt: undefined })),
  })).schedule;
  const dnext = new Date(daily.nextRunAt);
  check("a daily run lands at 19:00 IST", dnext.toISOString().slice(11, 16), "13:30"); // 19:00 IST = 13:30 UTC
  check("...in the future", dnext.getTime() > Date.now(), true);

  const targetDay = (istDay(new Date()) + 3) % 7;
  const weekly = (await client.api("/api/schedules", {
    method: "POST",
    body: JSON.stringify(mk({ name: TAG + "weekly", repeat: "weekly", atTime: "07:30", days: [targetDay], startAt: undefined })),
  })).schedule;
  const wnext = new Date(weekly.nextRunAt);
  check("a weekly run lands on the chosen weekday", istDay(wnext), targetDay);
  check("...at the chosen IST time", wnext.toISOString().slice(11, 16), "02:00"); // 07:30 IST = 02:00 UTC
  check("...within the next 8 days", wnext.getTime() - Date.now() < 8 * 86400000, true);

  // --- 3. a one-off fires once, then stands down ---------------------------
  const once = (await client.api("/api/schedules", {
    method: "POST", body: JSON.stringify(mk({ name: TAG + "fireonce" })),
  })).schedule;
  await db.query(`UPDATE schedule SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [once.id]);

  const jobsBefore = (await client.api("/api/bulk")).jobs.length;
  const run1 = await admin.api("/api/admin/schedules", { method: "POST" });
  check("a due schedule fires", run1.fired >= 1, true);
  const jobsAfter = (await client.api("/api/bulk")).jobs.length;
  check("...creating exactly one job", jobsAfter - jobsBefore, 1);

  const afterOnce = (await client.api(`/api/schedules/${once.id}`)).schedule;
  check("a one-off stands down after running", afterOnce.enabled, false);
  check("...with no next run left", afterOnce.nextRunAt, null);
  check("...and counted the run", afterOnce.runs, 1);
  check("...and remembers the job it started", !!afterOnce.lastJobId, true);

  // --- 4. no double firing --------------------------------------------------
  const dbl = (await client.api("/api/schedules", {
    method: "POST", body: JSON.stringify(mk({ name: TAG + "double" })),
  })).schedule;
  await db.query(`UPDATE schedule SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [dbl.id]);
  const before = (await client.api("/api/bulk")).jobs.length;
  // Two pollers racing on the same due schedule.
  await Promise.all([
    admin.api("/api/admin/schedules", { method: "POST" }),
    admin.api("/api/admin/schedules", { method: "POST" }),
  ]);
  const after = (await client.api("/api/bulk")).jobs.length;
  check("two pollers racing still produce ONE job", after - before, 1);
  const dblAfter = (await client.api(`/api/schedules/${dbl.id}`)).schedule;
  check("...and one run recorded", dblAfter.runs, 1);

  // --- 5. a repeating one advances and stays armed -------------------------
  await db.query(`UPDATE schedule SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [daily.id]);
  await admin.api("/api/admin/schedules", { method: "POST" });
  const dailyAfter = (await client.api(`/api/schedules/${daily.id}`)).schedule;
  check("a daily schedule stays armed", dailyAfter.enabled, true);
  check("...and moves to a future time", new Date(dailyAfter.nextRunAt).getTime() > Date.now(), true);
  check("...still at 19:00 IST", new Date(dailyAfter.nextRunAt).toISOString().slice(11, 16), "13:30");

  // --- 6. pause / resume ----------------------------------------------------
  await client.api(`/api/schedules/${daily.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
  await db.query(`UPDATE schedule SET next_run_at = now() - interval '1 hour' WHERE id = $1`, [daily.id]);
  const runsPaused = (await client.api(`/api/schedules/${daily.id}`)).schedule.runs;
  await admin.api("/api/admin/schedules", { method: "POST" });
  const stillPaused = (await client.api(`/api/schedules/${daily.id}`)).schedule;
  check("a paused schedule does not fire", stillPaused.runs, runsPaused);

  const resumed = (await client.api(`/api/schedules/${daily.id}`, {
    method: "PATCH", body: JSON.stringify({ enabled: true }) })).schedule;
  check("resuming re-arms it", resumed.enabled, true);
  check("...without firing the missed run", new Date(resumed.nextRunAt).getTime() > Date.now(), true);

  // --- 7. permissions -------------------------------------------------------
  await db.query(`UPDATE app_client SET perms = '["bulk"]'::jsonb WHERE id = $1`, [CID]);
  const noWa = makeSession();
  await noWa.login(CLIENT);
  const denied = await noWa.api("/api/schedules", {
    method: "POST", body: JSON.stringify(mk({ name: TAG + "denied" })),
  }).then(() => "allowed").catch((e) => e.status);
  check("scheduling WhatsApp needs the WhatsApp permission", denied, 403);
  await db.query(`UPDATE app_client SET perms = '["dial","bulk","campaigns","audios","reports","whatsapp","billing"]'::jsonb WHERE id = $1`, [CID]);

  // --- 8. isolation ---------------------------------------------------------
  await db.query(
    `INSERT INTO app_client (id, name, email, pass_hash, pass_salt, perms, active)
     VALUES ($1,'Other Sched','other-sched@test.local','x','y','["whatsapp"]'::jsonb, true)`, [OTHER_CLIENT]);
  await db.query(
    `INSERT INTO schedule (id, client_id, name, kind, repeat_rule, next_run_at, spec)
     VALUES ($1,$2,$3,'whatsapp','once', now() + interval '1 day', $4::jsonb)`,
    ["sch_other_test", OTHER_CLIENT, TAG + "other", JSON.stringify({ recipients: RECIPIENTS })]);

  const mine = (await client.api("/api/schedules")).schedules;
  check("another client's schedule is not listed", mine.some((s) => s.id === "sch_other_test"), false);
  const peek = await client.raw("/api/schedules/sch_other_test");
  check("...nor readable", peek.status, 404);
  const del = await client.raw("/api/schedules/sch_other_test", { method: "DELETE" });
  check("...nor deletable", del.status, 404);
  await db.query(`DELETE FROM schedule WHERE id = 'sch_other_test'`);

  // --- 9. delete ------------------------------------------------------------
  const gone = await client.api(`/api/schedules/${weekly.id}`, { method: "DELETE" });
  check("a schedule can be deleted", gone.ok, true);
  const after404 = await client.raw(`/api/schedules/${weekly.id}`);
  check("...and is then gone", after404.status, 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch(() => {}); await db.end().catch(() => {}); });
