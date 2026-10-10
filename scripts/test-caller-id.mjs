/**
 * Caller-ID (Plivo `from`) regression test.
 *
 * On 2026-08-29 every bulk call started failing with "Plivo error 400". The
 * cause was one field: a campaign whose caller ID had been saved as the bare
 * "8031805258", with no country code. Plivo requires E.164 for `from` and
 * rejects anything else — and because the caller ID is per-campaign, that one
 * bad field failed EVERY call on the campaign at once, which reads as "the
 * whole system is down" rather than "one field is wrong".
 *
 * The first fix only covered place-campaign-call.ts (the single test call and
 * the trigger API). Bulk dials through bulk-runner.ts, which built its own
 * `fromNumber` and passed it straight through — so the path that actually
 * broke was the one path not covered. The normalization now lives in
 * placeCall() itself, the single choke point all three dial paths pass through.
 *
 * What has to be true:
 *   - a bare 10-digit caller ID gains its country code (the 2026-08-29 bug);
 *   - a trunk-prefixed "0…" number is handled;
 *   - a number already carrying 91, with or without "+", is left alone;
 *   - a real E.164 international number is NOT re-homed to India;
 *   - a value normalization can't read is passed through, never dropped;
 *   - and the guard is genuinely wired into placeCall(), not just available.
 *
 * The last one matters: the first fix "existed" and bulk still would have
 * failed. So this asserts against the real source of plivo.ts and
 * bulk-runner.ts, not only against the helper in isolation.
 *
 * Usage:  node scripts/test-caller-id.mjs        (no database, no server)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(rel, exportNames) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = src
    .replace(/export\s+/g, "")
    .replace(/:\s*string\[\]/g, "")
    .replace(/:\s*string/g, "")
    .replace(/:\s*number/g, "")
    .replace(/:\s*boolean/g, "")
    .replace(/\bconst\s+(\w+)\s*:\s*\w+\[\]\s*=/g, "const $1 =");
  const fn = new Function(`${js}\nreturn { ${exportNames.join(", ")} };`);
  return fn();
}

const { normalizePhone } = loadTs("src/lib/phone.ts", ["normalizePhone"]);

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  PASS  " + label); }
  else {
    failed++;
    console.log("  FAIL  " + label);
    console.log("        expected " + JSON.stringify(expected));
    console.log("        got      " + JSON.stringify(actual));
  }
}

/**
 * Exactly what placeCall() now does to the caller ID before handing it to
 * Plivo: normalize, and fall back to the raw value rather than dropping it.
 */
function callerId(raw) {
  return raw ? normalizePhone(String(raw)) || raw : raw;
}

console.log("\ncaller ID sent to Plivo\n");

// --- the 2026-08-29 incident ----------------------------------------------
check("bare 10-digit gains the country code", callerId("8031805258"), "+918031805258");
check("trunk-prefixed 0 is stripped", callerId("08031805258"), "+918031805258");
check("spaced 10-digit still resolves", callerId("80318 05258"), "+918031805258");

// --- values that already work must NOT change -----------------------------
check("E.164 India untouched", callerId("+918031805258"), "+918031805258");
check("91 without a plus gains one", callerId("918031805258"), "+918031805258");
check("E.164 US untouched", callerId("+18885550100"), "+18885550100");
check("US 11-digit without a plus", callerId("18885550100"), "+18885550100");
check("00 access prefix becomes +", callerId("00918031805258"), "+918031805258");
check("formatted E.164 collapses", callerId("+91 80318 05258"), "+918031805258");

// --- nothing is dropped ---------------------------------------------------
check("unreadable value passes through", callerId("PLIVO"), "PLIVO");
check("empty stays empty", callerId(""), "");
check("undefined stays undefined", callerId(undefined), undefined);

// --- idempotent, so the caller-side guard is harmless ----------------------
check("normalizing twice is stable", callerId(callerId("8031805258")), "+918031805258");

// --- the guard is actually wired in ---------------------------------------
const plivoSrc = fs.readFileSync(path.join(root, "src/lib/plivo.ts"), "utf8");
check(
  "plivo.ts imports normalizePhone",
  /import\s*\{[^}]*normalizePhone[^}]*\}\s*from\s*["']\.\/phone["']/.test(plivoSrc),
  true,
);
check(
  "placeCall body sends the normalized from, not opts.fromNumber",
  /const\s+body\s*:[^=]*=\s*\{\s*\n\s*from,/.test(plivoSrc),
  true,
);
check(
  "placeCall no longer passes the raw fromNumber straight through",
  /from:\s*opts\.fromNumber/.test(plivoSrc),
  false,
);

// --- and every dial path really goes through placeCall ---------------------
for (const [label, rel] of [
  ["bulk worker", "src/lib/bulk-runner.ts"],
  ["single call + trigger API", "src/lib/place-campaign-call.ts"],
]) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  check(`${label} dials through placeCall()`, /\bplaceCall\s*\(/.test(src), true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
