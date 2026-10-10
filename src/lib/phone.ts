export function normalizePhone(raw: string, defaultCountry = "91"): string {
  const trimmed = (raw || "").trim();
  let digits = trimmed.replace(/\D+/g, "");
  if (!digits) return "";

  // International access prefix "00…" → "+…"
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  // Caller already typed E.164 with "+", trust the digits as-is.
  if (trimmed.startsWith("+")) return `+${digits}`;
  // Strip a single domestic trunk "0" (people type "09876543210").
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  // Bare 10-digit national number → prefix the default country code.
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  // Already carries the country code (e.g. "919876543210").
  if (digits.startsWith(defaultCountry) && digits.length === 10 + defaultCountry.length) {
    return `+${digits}`;
  }
  // Anything else: assume it's an international number missing its "+".
  return `+${digits}`;
}

/**
 * Is this normalized (+E.164) number long enough to be a real phone number?
 *
 * Live data had 8–9 digit numbers like "+545537007" being dialled — a mangled
 * Indian mobile that `normalizePhone` (rightly) can't repair, so it went out as
 * an "international" number and burned a call. An Indian number (+91) must be
 * exactly 12 digits; anything else must carry 10–15 digits (E.164 max is 15).
 */
export function isDiallablePhone(e164: string): boolean {
  const d = digitsOnly(e164);
  if (d.startsWith("91")) return d.length === 12;
  return d.length >= 10 && d.length <= 15;
}

/** One display form for every number: "+91 98765 43210", or "+<digits>" abroad. */
export function formatPhone(raw: string): string {
  const n = normalizePhone(raw);
  const d = digitsOnly(n);
  if (d.startsWith("91") && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return n || raw;
}

export function digitsOnly(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}
