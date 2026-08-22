/**
 * Presentation helpers for the Sheet call report — labels, colours, IST stamps
 * and file names, shared by the report UI and both export routes.
 *
 * Deliberately free of any database import: the report panel is a client
 * component, and pulling `gsheet-report.ts` in would drag `pg` into the browser
 * bundle. Same reason `gsheet-tab.ts` exists next to `gsheets.ts`.
 */

export const OUTCOME_LABEL: Record<string, string> = {
  press1: "Lifted + pressed 1",
  connected: "Lifted, no press",
  busy: "Busy",
  "no-answer": "Not lifted",
  rejected: "Rejected/invalid",
  error: "Carrier error",
  failed: "Could not place",
  "in-progress": "In progress",
};

/** Order the outcomes read in, best result first. */
export const OUTCOME_ORDER = [
  "press1",
  "connected",
  "busy",
  "no-answer",
  "rejected",
  "error",
  "failed",
  "in-progress",
];

/** Matches the campaign report's palette so the two read as one system. */
export const OUTCOME_COLOR: Record<string, string> = {
  press1: "#22C55E",
  connected: "#6366F1",
  busy: "#F59E0B",
  "no-answer": "#FBBF24",
  rejected: "#EF4444",
  error: "#DC2626",
  failed: "#B91C1C",
  "in-progress": "#7A8597",
};

export const OUTCOME_TONE: Record<string, "ok" | "accent" | "warn" | "danger" | "muted"> = {
  press1: "ok",
  connected: "accent",
  busy: "warn",
  "no-answer": "warn",
  rejected: "danger",
  error: "danger",
  failed: "danger",
  "in-progress": "muted",
};

const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;

/** ISO instant -> "YYYY-MM-DD HH:MM" in IST, the only clock this app thinks in. */
export function istStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_SHIFT_MS);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

/** ISO instant -> "YYYY-MM-DD" in IST. */
export function istDay(iso: string): string {
  return new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString().slice(0, 10);
}

/** Today in IST, as YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + IST_SHIFT_MS).toISOString().slice(0, 10);
}

/** N days before today in IST, as YYYY-MM-DD. */
export function istDayOffset(days: number): string {
  return new Date(Date.now() + IST_SHIFT_MS - days * 86400000).toISOString().slice(0, 10);
}

export function fmtDuration(sec: number | null): string {
  if (!sec) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Download file name: the sheet's own name plus the range it covers. */
export function reportFileSlug(s: {
  connName: string;
  from: string | null;
  to: string | null;
}): string {
  const name = (s.connName || "sheet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sheet";
  const range = s.from && s.to ? (s.from === s.to ? s.from : `${s.from}_to_${s.to}`) : "all-time";
  return `sheet-report-${name}-${range}`;
}
