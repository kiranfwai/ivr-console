/**
 * One way to show dates and times across the console (IST, Indian order):
 * "8 Oct 2026, 6:14 pm", "8 Oct 2026", "8 Oct". The UI used to mix five
 * formats (Oct 8 · 10/8/2026 · 08 Oct 2026 · 21 Sept 2026 · 09-13).
 *
 * Built by hand rather than with toLocale*: both en-IN and current en-GB
 * abbreviate September as "Sept", and browsers disagree on am/pm casing.
 * Browser-safe: no server imports.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_MS = 330 * 60_000;

/** The IST wall-clock parts of an instant (read via the UTC getters). */
function ist(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : new Date(t + IST_MS);
}

function clock(d: Date): string {
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

/** "8 Oct 2026, 6:14 pm" — with `short`, the year is dropped when it is this year. */
export function fmtDateTime(iso: string | null | undefined, opts: { short?: boolean } = {}): string {
  const d = ist(iso);
  if (!d) return "—";
  const thisYear = ist(new Date().toISOString())!.getUTCFullYear();
  const year = opts.short && d.getUTCFullYear() === thisYear ? "" : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}, ${clock(d)}`;
}

/** "8 Oct 2026" */
export function fmtDate(iso: string | null | undefined): string {
  const d = ist(iso);
  if (!d) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A "YYYY-MM-DD" day key (already IST) → "8 Oct". For chart axes. */
export function fmtDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return `${d} ${MONTHS[m - 1]}`;
}
