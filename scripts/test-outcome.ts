/**
 * deriveOutcome — the single rule behind billing (hangup), report outcomes,
 * dashboard counters and "retry failed". Pure function, no database.
 *
 *   npx tsx scripts/test-outcome.ts
 */
import { deriveOutcome, RETRY_STATUSES } from "../src/lib/outcome";
import { causeLabel, statusLabel } from "../src/lib/report-format";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}

console.log("billing bug: answered calls cut by the time limit");
eq("answered + ALLOTTED_TIMEOUT -> connected (billed)", deriveOutcome("ALLOTTED_TIMEOUT", "", true), "connected");
eq("answered + ALLOTTED_TIMEOUT + pressed 1 -> press1", deriveOutcome("ALLOTTED_TIMEOUT", "1", true), "press1");
eq("unanswered + ALLOTTED_TIMEOUT -> no-answer", deriveOutcome("ALLOTTED_TIMEOUT", undefined, false), "no-answer");
eq("connected is not re-dialled by retry", RETRY_STATUSES.has(deriveOutcome("ALLOTTED_TIMEOUT", "", true)), false);
eq("report status label", statusLabel(deriveOutcome("ALLOTTED_TIMEOUT", "", true)), "Answered");
eq("report cause label", causeLabel("ALLOTTED_TIMEOUT"), "Call time limit reached");

console.log("unchanged behaviour");
eq("NORMAL_CLEARING answered -> connected", deriveOutcome("NORMAL_CLEARING", "", true), "connected");
eq("NORMAL_CLEARING unanswered -> no-answer", deriveOutcome("NORMAL_CLEARING", "", false), "no-answer");
eq("NO_ANSWER -> no-answer", deriveOutcome("NO_ANSWER", "", false), "no-answer");
eq("NO_USER_RESPONSE -> no-answer", deriveOutcome("NO_USER_RESPONSE", "", false), "no-answer");
eq("USER_BUSY -> busy", deriveOutcome("USER_BUSY", "", false), "busy");
eq("CALL_REJECTED -> rejected", deriveOutcome("CALL_REJECTED", "", false), "rejected");
eq("NORMAL_TEMPORARY_FAILURE -> error", deriveOutcome("NORMAL_TEMPORARY_FAILURE", "", false), "error");
eq("digit 1 wins over anything", deriveOutcome("USER_BUSY", "1", true), "press1");
eq("unknown cause answered -> connected", deriveOutcome("SOMETHING_NEW", "", true), "connected");
eq("unknown cause unanswered -> no-answer", deriveOutcome("SOMETHING_NEW", "", false), "no-answer");
eq("no-answer still retried", RETRY_STATUSES.has("no-answer"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
