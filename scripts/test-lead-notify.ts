/**
 * "Everyone, when the call is placed" — WhatsApp + email dedupe test.
 *
 * Drives the real dial paths (placeCampaignCall, the bulk worker's fireOne and
 * the Sheet Auto-Dial poller) against a sandbox Postgres with `fetch` stubbed:
 * Plivo answers with a fake call id and Pabbly is a counter, so nothing is ever
 * dialled or messaged. What it proves is that every lead gets exactly one
 * message whatever happens to the call — and never two.
 *
 * Usage (a THROWAWAY local database — the script refuses anything else):
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npx tsx scripts/test-lead-notify.ts
 */
import http from "node:http";

const DB = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB)) {
  console.error("Refusing to run: DATABASE_URL must point at a local sandbox database.");
  process.exit(2);
}
process.env.PABBLY_TIMEOUT_MS = "400";
process.env.PABBLY_RETRY_BASE_MS = "10";
process.env.LEAD_NOTIFY_SWEEP_MS = "200";
process.env.PLIVO_AUTH_ID = "MAFAKE";
process.env.PLIVO_AUTH_TOKEN = "fake";
process.env.PLIVO_CPS = "1000";
process.env.PUBLIC_BASE_URL = "http://127.0.0.1:9";
process.env.GSHEETS_CSV_BASE = "http://127.0.0.1:4617"; // read at module load

// --- fetch stub: Plivo + Pabbly --------------------------------------------

const PABBLY = "https://pabbly.test/hook";
const PABBLY_SLOW = "https://pabbly.test/slow";
let pabbly: any[] = [];
let slowHits = 0;
let plivoStatus = 201;
let plivoCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (url.startsWith("https://api.plivo.com/")) {
    plivoCalls++;
    const ok = plivoStatus < 300;
    return new Response(
      JSON.stringify(ok ? { request_uuid: `req-${plivoCalls}`, api_id: "x" } : { error: "rejected" }),
      { status: plivoStatus, headers: { "content-type": "application/json" } },
    );
  }
  if (url === PABBLY) {
    pabbly.push(JSON.parse(init.body));
    return new Response('{"ok":true}', { status: 200 });
  }
  if (url === PABBLY_SLOW) {
    slowHits++;
    // Never answers inside PABBLY_TIMEOUT_MS; honour the abort like real fetch.
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

// --- harness ------------------------------------------------------------------

let passed = 0, failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${ok ? "" : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function sentTo(phone: string) {
  return pabbly.filter((p) => p.phone === phone);
}

async function main() {
  const { query } = await import("../src/lib/db");
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createCampaign } = await import("../src/lib/campaigns");
  const { placeCampaignCall, DndSkipError, InsufficientBalanceError } = await import("../src/lib/place-campaign-call");
  const { fireOne } = await import("../src/lib/bulk-runner");
  const { addDnd } = await import("../src/lib/dnd");
  const { getCall } = await import("../src/lib/calls");
  const { notifyWhatsapp } = await import("../src/lib/whatsapp-notify");
  const lead = await import("../src/lib/lead-notify");
  const { pollClient, getGSheetConn } = await import("../src/lib/gsheets");

  // Clean slate for everything this test touches.
  await query(`TRUNCATE lead_notify, gsheet_lead, gsheet_conn`);
  await query(`DELETE FROM kv; DELETE FROM sset; DELETE FROM client_wallet`).catch(() => {});
  const CL = "cl_test", LOW = "cl_low";
  await query(`INSERT INTO client_wallet (client_id, balance) VALUES ($1, 1000)`, [CL]);

  await lead.startLeadNotifier();
  const drain = async () => { await lead.sweepLeadNotifies(); await sleep(50); await lead.sweepLeadNotifies(); };

  const mk = (clientId: string, whatsappTrigger: string, webhookUrl = PABBLY) =>
    runWithTenant(clientId, () =>
      createCampaign({ name: `c-${whatsappTrigger}`, audioId: "a1", webhookUrl, fromNumber: "+918031321235", whatsappTrigger }),
    );
  const always = await mk(CL, "always");
  const press1 = await mk(CL, "press1");
  const answer = await mk(CL, "answer");
  const call = (clientId: string, campaign: any, phone: string, extra: any = {}) =>
    runWithTenant(clientId, () =>
      placeCampaignCall({ campaign, phone, callerName: "Keerthi", email: "k@example.com", ...extra }),
    );

  console.log("\n1. always: placed call sends once, in the Pabbly shape");
  const r1 = await call(CL, always, "9876500001");
  await drain();
  const p1 = sentTo("919876500001");
  check("one message", p1.length, 1);
  check("payload", p1[0] && {
    to: p1[0].to, phone: p1[0].phone, lead: p1[0].lead, from: p1[0].from, name: p1[0].name,
    email: p1[0].email, digit: p1[0].digit, campaign: p1[0].campaign, callUuid: p1[0].callUuid, call: p1[0].call, event: p1[0].event, has_email: p1[0].has_email,
  }, {
    to: "919876500001", phone: "919876500001", lead: "919876500001", from: "918031321235", name: "Keerthi",
    email: "k@example.com", digit: "", campaign: "c-always", callUuid: r1.callUuid, call: "placed", event: "call_placed", has_email: "yes",
  });
  const rec1 = await runWithTenant(CL, () => getCall(r1.callUuid));
  check("call record marked + shows the send", [rec1?.notifyOnPlace, rec1?.pabblyStatus, !!rec1?.whatsappSentAt], [true, 200, true]);

  console.log("\n2. always: answer / press 1 afterwards send nothing more");
  const n2 = await runWithTenant(CL, () => notifyWhatsapp(r1.callUuid, { event: "press1", digit: "1" }));
  check("press-1 suppressed", n2.sent, false);
  check("still one message", sentTo("919876500001").length, 1);

  console.log("\n3. always: Plivo refuses the call — still one message");
  plivoStatus = 400;
  const r3 = await call(CL, always, "9876500003");
  plivoStatus = 201;
  await drain();
  check("call not ok", r3.ok, false);
  check("one message, call=call_failed", sentTo("919876500003").map((p) => p.call), ["call_failed"]);

  console.log("\n4. always: DND number — no call, still one message");
  await runWithTenant(CL, () => addDnd(["9876500004"]));
  const before4 = plivoCalls;
  let dnd = false;
  try { await call(CL, always, "9876500004"); } catch (e) { dnd = e instanceof DndSkipError; }
  await drain();
  check("DND skip thrown, no Plivo call", [dnd, plivoCalls - before4], [true, 0]);
  check("one message, call=dnd", sentTo("919876500004").map((p) => p.call), ["dnd"]);

  console.log("\n5. always: low wallet — no call, still one message");
  const alwaysLow = await mk(LOW, "always");
  let low = false;
  try { await call(LOW, alwaysLow, "9876500005"); } catch (e) { low = e instanceof InsufficientBalanceError; }
  await drain();
  check("balance error thrown", low, true);
  check("one message, call=low_balance", sentTo("919876500005").map((p) => p.call), ["low_balance"]);

  console.log("\n6. press1 / answer campaigns queue nothing on place");
  await call(CL, press1, "9876500006");
  await call(CL, answer, "9876500007");
  await drain();
  check("no messages", [sentTo("919876500006").length, sentTo("919876500007").length], [0, 0]);

  console.log("\n7. sheet key: same phone re-called / in another sheet — one message");
  const key = lead.sheetNotifyKey(CL, "9876500008");
  await call(CL, always, "9876500008", { notifyKey: key, notifySource: "sheet" });
  await call(CL, always, "+91 98765 00008", { notifyKey: lead.sheetNotifyKey(CL, "+91 98765 00008"), notifySource: "sheet" });
  await drain();
  check("two calls placed, one message", sentTo("919876500008").length, 1);

  console.log("\n8. bulk row dialled twice (429 re-queue) — one message");
  const bulkRow = { index: 3, phone: "9876500009", name: "B", email: "b@example.com" };
  await runWithTenant(CL, () => fireOne("job_x", bulkRow, always, "http://127.0.0.1:9"));
  await runWithTenant(CL, () => fireOne("job_x", bulkRow, always, "http://127.0.0.1:9"));
  await drain();
  check("one message", sentTo("919876500009").length, 1);

  console.log("\n9. 25 concurrent enqueues of one lead + parallel sweeps — one message");
  await Promise.all(Array.from({ length: 25 }, () =>
    lead.enqueueLeadNotify({
      clientId: CL, source: "sheet", dedupeKey: lead.sheetNotifyKey(CL, "9876500010"),
      campaign: always, phone: "9876500010", call: "placed",
    }),
  ));
  await Promise.all([lead.sweepLeadNotifies(), lead.sweepLeadNotifies(), lead.sweepLeadNotifies()]);
  await drain();
  check("one message", sentTo("919876500010").length, 1);

  console.log("\n10. restart mid-send — marked unknown, NOT re-sent");
  await query(
    `INSERT INTO lead_notify (dedupe_key, client_id, source, phone, webhook_url, payload, status, claimed_at)
     VALUES ('call:orphan', $1, 'call', '919876500011', $2, '{"phone":"919876500011"}', 'sending', now())`,
    [CL, PABBLY],
  );
  (globalThis as any).__ivrLeadNotifyStarted = false;
  await lead.startLeadNotifier();
  await drain();
  const { rows: orphan } = await query(`SELECT status FROM lead_notify WHERE dedupe_key = 'call:orphan'`);
  check("status unknown, nothing sent", [orphan[0]?.status, sentTo("919876500011").length], ["unknown", 0]);

  console.log("\n11. Pabbly times out — one attempt, marked unknown (no duplicate risk)");
  const slow = await mk(CL, "always", PABBLY_SLOW);
  await call(CL, slow, "9876500012");
  await drain();
  await sleep(600);
  const { rows: s11 } = await query(`SELECT status FROM lead_notify WHERE phone = '919876500012'`);
  check("one POST, status unknown", [slowHits, s11[0]?.status], [1, "unknown"]);

  console.log("\n12. Sheet Auto-Dial poll: same number in two sheets + re-poll — one message each");
  const csv = "name,phone,email\nAsha,9876500020,a@example.com\nRavi,9876500021,r@example.com\nAsha again,+919876500020,\n";
  const srv = http.createServer((_, res) => { res.writeHead(200, { "content-type": "text/csv" }); res.end(csv); });
  await new Promise<void>((r) => srv.listen(4617, r));
  for (const id of ["conn-a", "conn-b"]) {
    await query(
      `INSERT INTO gsheet_conn (id, client_id, sheet_id, tab_name, campaign_id, call_start_hour, call_end_hour)
       VALUES ($1, $2, 'sheet-' || $1, 'Sheet1', $3, 0, 24)`,
      [id, CL, always.id],
    );
  }
  const plivoBefore = plivoCalls;
  for (let i = 0; i < 2; i++) {
    for (const id of ["conn-a", "conn-b"]) await pollClient((await getGSheetConn(id))!);
  }
  await drain();
  check("each sheet called each person once (4 calls)", plivoCalls - plivoBefore, 4);
  check("Asha: one message", sentTo("919876500020").length, 1);
  check("Ravi: one message", sentTo("919876500021").length, 1);
  check("message carries sheet name + email", [sentTo("919876500020")[0]?.name, sentTo("919876500020")[0]?.email], ["Asha", "a@example.com"]);

  console.log("\n13. lead with no email — WhatsApp still sent, has_email=no, no email field");
  await runWithTenant(CL, () => placeCampaignCall({ campaign: always, phone: "9876500030", callerName: "NoMail" }));
  await drain();
  const p13 = sentTo("919876500030");
  check("one message, has_email=no, email absent", [p13.length, p13[0]?.has_email, "email" in (p13[0] || {})], [1, "no", false]);
  srv.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
