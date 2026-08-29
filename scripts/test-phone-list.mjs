/**
 * Phone-list parsing test — how a pasted blob becomes a list of numbers.
 *
 * This is the parser behind the Do-Not-Disturb paste box. It had a bug worth
 * a regression test: the old code split on ANY whitespace, so "+91 88255 74083"
 * — the normal way to write an Indian number — became three fragments, all of
 * which were stored, while the actual number was never blocked. The UI then
 * reported success. On a DND list that means calling someone who asked you not
 * to.
 *
 * What has to be true:
 *   - a number with spaces inside it stays ONE number;
 *   - one number per line is the common case and must be exact;
 *   - commas, semicolons, tabs and pipes separate entries (CSV paste);
 *   - names, headers and emails on the line are ignored, not stored;
 *   - a line genuinely holding several numbers still comes apart;
 *   - and nothing is silently dropped.
 *
 * Runs against src/lib/phone-list.ts itself — the TS types are stripped and the
 * real source is evaluated, so this cannot drift from the shipped code the way
 * a hand-copied version would.
 *
 * Usage:  node scripts/test-phone-list.mjs        (no database, no server)
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
    .replace(/\bconst\s+(\w+)\s*:\s*\w+\[\]\s*=/g, "const $1 =");
  const fn = new Function(`${js}\nreturn { ${exportNames.join(", ")} };`);
  return fn();
}

const { parsePhoneList } = loadTs("src/lib/phone-list.ts", ["parsePhoneList"]);
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

/** What actually lands on the list: parsed, then normalized, then de-duplicated. */
function stored(text) {
  return [...new Set(parsePhoneList(text).map((p) => normalizePhone(p)).filter(Boolean))];
}

console.log("\nphone-list parsing\n");

// --- the regression that started this -------------------------------------
check(
  "spaced number stays one number",
  stored("+91 88255 74083"),
  ["+918825574083"],
);

check(
  "the exact paste that used to store 7 fragments and block nothing",
  stored(`+91 88255 74083
            +91 88255 74083
+91 98200 38609
+91 87222 20567
+91 98200 38609`),
  ["+918825574083", "+919820038609", "+918722220567"],
);

// --- everyday shapes -------------------------------------------------------
check("one per line", stored("9876543210\n9812345678"), ["+919876543210", "+919812345678"]);
check("comma separated", stored("9876543210, 9812345678"), ["+919876543210", "+919812345678"]);
check("semicolons and tabs", stored("9876543210;9812345678\t9811111111"),
  ["+919876543210", "+919812345678", "+919811111111"]);
check("leading trunk zero", stored("09876543210"), ["+919876543210"]);
check("already E.164", stored("+919876543210"), ["+919876543210"]);
check("dashes and brackets inside a number", stored("(+91) 98765-43210"), ["+919876543210"]);
check("blank lines and stray spaces", stored("\n  9876543210  \n\n"), ["+919876543210"]);
check("duplicates collapse", stored("9876543210\n+919876543210\n09876543210"), ["+919876543210"]);

// --- CSV-ish paste ---------------------------------------------------------
check(
  "CSV row keeps only the number",
  stored("Ramesh K,ramesh@example.com,+91 88255 74083"),
  ["+918825574083"],
);
check("a header row contributes nothing", stored("name,email,phone"), []);
check("text with no digits is ignored", stored("Ramesh\nSunita"), []);

// --- genuinely multiple numbers on one line --------------------------------
check(
  "two bare numbers on one line still split",
  stored("9876543210 9812345678"),
  ["+919876543210", "+919812345678"],
);
check(
  "two spaced +91 numbers on one line split on the plus",
  stored("+91 88255 74083 +91 98200 38609"),
  ["+918825574083", "+919820038609"],
);

// --- nothing vanishes ------------------------------------------------------
check("empty input", stored(""), []);
check("whitespace only", stored("   \n\t  "), []);

const bulk = Array.from({ length: 500 }, (_, i) => `+91 98 ${String(20000000 + i)}`);
check("500 spaced numbers all survive", stored(bulk.join("\n")).length, 500);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
