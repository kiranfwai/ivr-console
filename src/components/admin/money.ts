/** Shared helpers for the admin Financials / Reports views. */

const LOCALE_BY_CURRENCY: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
};

/** Format an amount in the given currency (e.g. 536 -> "₹536.00"). */
export function fmtMoney(n: number, currency = "INR"): string {
  const locale = LOCALE_BY_CURRENCY[currency] || "en-IN";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toFixed(2)}`;
  }
}

/** The bare currency symbol (₹, $) for the given code. */
export function currencySymbol(currency = "INR"): string {
  try {
    const parts = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] || "en-IN", {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** IST "today" as YYYY-MM-DD, matching the reports/stats day bucketing. */
export function istToday(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

/** N days before IST today, as YYYY-MM-DD. */
export function istDaysAgo(days: number): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000 - days * 86400000)
    .toISOString()
    .slice(0, 10);
}
