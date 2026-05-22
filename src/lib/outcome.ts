import type { BulkRowStatus } from "./models";

const BUSY = new Set([
  "Busy Line",
  "USER_BUSY",
  "BUSY_PATTERN",
  "User Busy",
]);
const NO_ANSWER = new Set([
  "No Answer",
  "NO_ANSWER",
  "NO_USER_RESPONSE",
  "SUBSCRIBER_ABSENT",
  "ALLOTTED_TIMEOUT",
  "USER_NOT_REGISTERED",
]);
const REJECTED = new Set([
  "Rejected",
  "CALL_REJECTED",
  "REJECT",
  "Invalid Number",
  "INVALID_NUMBER_FORMAT",
  "UNALLOCATED_NUMBER",
  "DESTINATION_OUT_OF_ORDER",
  "CHANNEL_UNACCEPTABLE",
]);
const ERROR = new Set([
  "Error Reaching Answer URL",
  "Internal Error From Carrier",
  "NORMAL_TEMPORARY_FAILURE",
  "TEMPORARY_FAILURE",
  "SWITCH_CONGESTION",
]);
const CONNECTED = new Set([
  "Normal Hangup",
  "NORMAL_CLEARING",
  "NORMAL_UNSPECIFIED",
  "End Of XML Instructions",
  "Cancel",
]);

/**
 * Derive a bulk-row outcome from a call's terminal state + Plivo HangupCause.
 * - press1: digit "1" was pressed (engaged) — highest priority
 * - connected: answered but no press-1
 * - busy / no-answer / rejected / error: didn't connect or invalid
 */
export function deriveOutcome(
  hangupCause: string | undefined,
  digit: string | undefined,
  answered: boolean
): BulkRowStatus {
  if (digit === "1") return "press1";

  const c = hangupCause || "";
  if (BUSY.has(c)) return "busy";
  if (NO_ANSWER.has(c)) return "no-answer";
  if (REJECTED.has(c)) return "rejected";
  if (ERROR.has(c)) return "error";
  if (CONNECTED.has(c)) return answered ? "connected" : "no-answer";

  // Unknown cause: if the call was answered we count it as connected, else no-answer.
  return answered ? "connected" : "no-answer";
}

/** Statuses worth retrying in a "retry failed" run. */
export const RETRY_STATUSES = new Set<BulkRowStatus>(["no-answer", "busy", "error", "failed"]);

/** Statuses you shouldn't retry (already engaged or known-bad number). */
export const SKIP_RETRY_STATUSES = new Set<BulkRowStatus>(["press1", "connected", "rejected", "ok"]);
