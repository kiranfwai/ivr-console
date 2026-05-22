export function normalizePhone(raw: string, defaultCountry = "91"): string {
  const digits = (raw || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.startsWith(defaultCountry) && digits.length === 10 + defaultCountry.length) {
    return `+${digits}`;
  }
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
}

export function digitsOnly(raw: string): string {
  return (raw || "").replace(/\D+/g, "");
}
