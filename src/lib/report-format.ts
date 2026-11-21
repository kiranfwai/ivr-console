/**
 * Pure helpers shared by the Call reports screen and the CSV export route.
 * No server imports here — the client component reads CSV_COLUMNS and the
 * labels from this file too, so the "Columns" popover always matches the file.
 */
import type { CallRecord } from "./models";
import { deriveOutcome } from "./outcome";

/** One row per call, in this exact order (matches a Wavelength call log). */
export const CSV_COLUMNS = [
  "Call ID",
  "Date",
  "Time (IST)",
  "Campaign",
  "Phone",
  "Name",
  "Email",
  "Call status",
  "Answered",
  "Duration (sec)",
  "Duration",
  "Key pressed",
  "Pressed 1",
  "WhatsApp sent",
  "Hang-up reason",
  "Caller ID",
  "Source",
  "Cost (₹)",
] as const;

const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;

/** yyyy-mm-dd of an ISO instant, on the IST calendar. */
export function istDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + IST_SHIFT_MS).toISOString().slice(0, 10);
}

/** HH:MM:SS of an ISO instant, in IST. */
export function istTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + IST_SHIFT_MS).toISOString().slice(11, 19);
}

/** 75 -> "1:15". */
export function mmss(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The settled outcome of a call, or "pending" while it is still in progress. */
export function callOutcome(c: Pick<CallRecord, "hangupAt" | "status" | "hangupCause" | "digit" | "answeredAt">): string {
  // A place-call that failed outright never reached the carrier: it is counted
  // as an error in the report counters (stats.recordPlaced), so say "Failed".
  if (c.status === "failed" && !c.hangupAt) return "error";
  if (!c.hangupAt) return "pending";
  return deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt);
}

/** Plain-language call status for an outcome. */
export function statusLabel(outcome: string): string {
  switch (outcome) {
    case "press1":
    case "connected":
      return "Answered";
    case "busy":
      return "Busy";
    case "no-answer":
      return "No answer";
    case "rejected":
      return "Rejected / invalid number";
    case "error":
    case "failed":
      return "Failed";
    default:
      return "In progress";
  }
}

/** Plain names for the carrier's hangup codes. */
const CAUSE_LABEL: Record<string, string> = {
  NORMAL_CLEARING: "Call ended normally",
  "Normal Hangup": "Call ended normally",
  "End Of XML Instructions": "Call ended normally",
  NO_ANSWER: "No answer",
  "No Answer": "No answer",
  NO_USER_RESPONSE: "No response",
  ALLOTTED_TIMEOUT: "Call time limit reached",
  USER_BUSY: "Busy",
  "Busy Line": "Busy",
  CALL_REJECTED: "Rejected",
  UNALLOCATED_NUMBER: "Number not in use",
  NUMBER_CHANGED: "Number changed",
  INVALID_NUMBER_FORMAT: "Invalid number",
  SUBSCRIBER_ABSENT: "Phone switched off / out of reach",
  NETWORK_OUT_OF_ORDER: "Network problem",
  NORMAL_TEMPORARY_FAILURE: "Temporary network failure",
  RECOVERY_ON_TIMER_EXPIRE: "Network timed out",
  ORIGINATOR_CANCEL: "Cancelled before answer",
};
export function causeLabel(code: string | null | undefined): string {
  if (!code) return "";
  if (CAUSE_LABEL[code]) return CAUSE_LABEL[code];
  const s = code.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lowercase-dash slug for file names. */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "campaign"
  );
}

/** "campaigns=a,b" plus the older single "campaign=a"; de-duplicated, empty = all. */
export function parseCampaignIds(sp: URLSearchParams): string[] {
  const out: string[] = [];
  for (const raw of sp.getAll("campaigns")) {
    for (const id of raw.split(",")) if (id.trim()) out.push(id.trim());
  }
  for (const raw of sp.getAll("campaign")) if (raw.trim()) out.push(raw.trim());
  return Array.from(new Set(out));
}
