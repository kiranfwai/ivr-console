/**
 * Indian GST state codes, and the checks that go with a billing identity.
 *
 * The first two digits of a GSTIN ARE the state code — so when someone gives us
 * a GSTIN we do not ask them for their state as well, we read it. That is the
 * single fact this file exists for; everything else here is the format checking
 * that keeps a malformed number off a tax document.
 *
 * No database, no `pg` import: this is shared by the browser bundle and the
 * server, the same reason `gsheet-tab.ts` and `invoice-format` are split out.
 */

export interface GstState {
  /** Two-digit code, e.g. "29". */
  code: string;
  name: string;
  /**
   * Superseded by a later reorganisation. Still resolves, because old GSTINs
   * carrying it are real, but it is not offered as a fresh choice.
   */
  legacy?: boolean;
}

/** Every code the GST system has issued, newest scheme first. */
export const GST_STATES: GstState[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "25", name: "Daman and Diu", legacy: true },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (undivided)", legacy: true },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

const BY_CODE = new Map(GST_STATES.map((s) => [s.code, s]));
const BY_NAME = new Map(GST_STATES.map((s) => [s.name.toLowerCase(), s]));

/** The states offered in a picker — every current one, no superseded codes. */
export const SELECTABLE_STATES: GstState[] = GST_STATES.filter((s) => !s.legacy);

export function stateByCode(code: string): GstState | null {
  return BY_CODE.get(String(code || "").trim().slice(0, 2)) ?? null;
}

export function stateByName(name: string): GstState | null {
  return BY_NAME.get(String(name || "").trim().toLowerCase()) ?? null;
}

/**
 * The state a GSTIN belongs to, from its first two digits.
 *
 * Deliberately does NOT require the whole number to be valid — someone
 * half-way through typing has already told us their state by digit two, and
 * filling the field then is more useful than waiting for all fifteen.
 */
export function stateFromGstin(gstin: string): GstState | null {
  const g = String(gstin || "").trim();
  return /^[0-9]{2}/.test(g) ? stateByCode(g.slice(0, 2)) : null;
}

/** 15 characters: state code, PAN, entity digit, 'Z', checksum. */
export function isValidGstin(gstin: string): boolean {
  const g = String(gstin || "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  return !!stateByCode(g.slice(0, 2));
}

/** 10 characters: AAAAA0000A. */
export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan || "").trim().toUpperCase());
}

/** Six digits, and no Indian PIN starts with 0. */
export function isValidPincode(pin: string): boolean {
  return /^[1-9][0-9]{5}$/.test(String(pin || "").trim());
}

/** The PAN embedded in a GSTIN — characters 3 to 12. */
export function panFromGstin(gstin: string): string {
  const g = String(gstin || "").trim().toUpperCase();
  return isValidGstin(g) ? g.slice(2, 12) : "";
}

export interface AddressParts {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

/**
 * The one-line address that gets printed.
 *
 * The invoice PDF, the interstate decision and every invoice already issued all
 * read a single `address` string, so the structured fields compose back into
 * one rather than replacing it. Blank parts simply drop out.
 */
export function composeAddress(p: AddressParts): string {
  const tail = [p.city, p.state].map((s) => String(s || "").trim()).filter(Boolean).join(", ");
  const pin = String(p.pincode || "").trim();
  return [
    String(p.line1 || "").trim(),
    String(p.line2 || "").trim(),
    pin ? [tail, pin].filter(Boolean).join(" ") : tail,
  ].filter(Boolean).join(", ");
}

/** True when any part of an address block has been filled in. */
export function hasAnyAddress(p: AddressParts): boolean {
  return [p.line1, p.line2, p.city, p.state, p.pincode].some((v) => !!String(v || "").trim());
}
