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

export function digitsOnly(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}
