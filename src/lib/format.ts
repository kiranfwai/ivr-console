/**
 * One way to show dates and times across the console (IST, Indian order):
 * "8 Oct 2026, 6:14 pm", "8 Oct 2026", "8 Oct". The UI used to mix five
 * formats (Oct 8 · 10/8/2026 · 08 Oct 2026 · 21 Sept 2026 · 09-13). en-GB, not
 * en-IN: en-IN abbreviates September as "Sept".
 * Browser-safe: no server imports.
 */
const TZ = "Asia/Kolkata";

function valid(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** "8 Oct 2026, 6:14 pm" — drops the year when it is the current year if `short`. */
export function fmtDateTime(iso: string | null | undefined, opts: { short?: boolean } = {}): string {
  const d = valid(iso);
  if (!d) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-GB", {
    timeZone: TZ, day: "numeric", month: "short",
    ...(opts.short && sameYear ? {} : { year: "numeric" }),
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

/** "8 Oct 2026" */
export function fmtDate(iso: string | null | undefined): string {
  const d = valid(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
}

/** A "YYYY-MM-DD" day key (already IST) → "8 Oct". For chart axes. */
export function fmtDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
}
