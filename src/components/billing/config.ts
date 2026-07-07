// Billing configuration — tweak these to change pricing/limits app-wide.
// Kept as plain constants (no inline magic numbers in components) so the
// finance team can adjust rates without hunting through JSX.

/** Price charged per credit, in INR. e.g. 4.5 → Rs 4.5 / credit. */
export const CREDIT_RATE_INR = 4.5;

/** GST applied on the credits price, as a fraction. 0.18 → 18%. */
export const GST_RATE = 0.18;

/** Purchase bounds for a single "Add Credits" order. */
export const MIN_CREDITS = 10;
export const MAX_CREDITS = 10_000;

/** Default prefill for the Add Credits input. */
export const DEFAULT_CREDITS = 100;

/** Rows shown per page in the transaction history before "Load more". */
export const TXN_PAGE_SIZE = 15;

/** Price breakdown for a given number of credits. All values in INR. */
export function priceBreakdown(credits: number) {
  const base = credits * CREDIT_RATE_INR;
  const gst = base * GST_RATE;
  const total = base + gst;
  return { base, gst, total };
}

/** ₹ formatter with Indian digit grouping (1,00,000). */
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatINR(amount: number): string {
  return inr.format(amount);
}

/** Whole-number ₹ (no paise) — used for round summaries like monthly cost. */
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
export function formatINR0(amount: number): string {
  return inr0.format(amount);
}

/** Signed credits, e.g. +120 / -45, for ledger amount columns. */
export function formatCredits(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Math.abs(amount).toLocaleString("en-IN")}`;
}

// Dates across the app are shown in IST (Asia/Kolkata) — match that here.
const istDate = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
/** "04 Jul 2026" in IST from an ISO string. */
export function formatDate(iso: string): string {
  return istDate.format(new Date(iso));
}
