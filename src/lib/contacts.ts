import { normalizePhone } from "./phone";

/**
 * CSV → contact rows, with transparent counting (BUG 4).
 *
 * Goals:
 *  - Require ONLY a phone. Missing name/email never drops a row.
 *  - Tolerate quoted fields ("Doe, John") so an embedded comma can't shift the
 *    phone column and silently drop the row.
 *  - Deduplicate on the normalized phone, but report exactly how many were
 *    removed — never silently shrink the count.
 *  - Never cap the number of rows.
 */

const PHONE_KEYS = ["phone", "mobile", "number", "contact", "tel", "mob", "msisdn"];
const NAME_KEYS = ["name", "full name", "fullname", "lead", "first name", "firstname"];
const EMAIL_KEYS = ["email", "email address", "e-mail", "emailid", "email id"];

export interface Contact {
  phone: string;
  name?: string;
  email?: string;
}

export interface ParseStats {
  totalRows: number; // candidate data rows (non-blank, excluding a header)
  loaded: number; // unique contacts kept
  noPhone: number; // rows skipped because the phone column had no digits
  duplicates: number; // rows removed as duplicate phone numbers
  hadHeader: boolean;
}

export interface ParseResult {
  rows: Contact[];
  stats: ParseStats;
}

const EMPTY: ParseResult = {
  rows: [],
  stats: { totalRows: 0, loaded: 0, noPhone: 0, duplicates: 0, hadHeader: false },
};

/** Split one CSV line, honoring double-quoted fields and escaped "" quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseContacts(csv: string): ParseResult {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { rows: [], stats: { ...EMPTY.stats } };

  const firstLower = lines[0].toLowerCase();
  const hadHeader = PHONE_KEYS.some((k) => firstLower.includes(k));

  let pIdx = 0;
  let nIdx = -1;
  let eIdx = -1;
  let dataLines = lines;
  if (hadHeader) {
    const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    pIdx = header.findIndex((h) => PHONE_KEYS.includes(h));
    nIdx = header.findIndex((h) => NAME_KEYS.includes(h));
    eIdx = header.findIndex((h) => EMAIL_KEYS.includes(h));
    if (pIdx < 0) pIdx = 0; // header present but no exact phone column — assume col 0
    dataLines = lines.slice(1);
  }

  const rows: Contact[] = [];
  const seen = new Set<string>();
  let noPhone = 0;
  let duplicates = 0;

  for (const line of dataLines) {
    const cols = splitCsvLine(line).map((c) => c.trim());
    const phone = (pIdx >= 0 ? cols[pIdx] : cols[0]) || "";
    // Only the phone is required.
    if (!/\d/.test(phone)) {
      noPhone++;
      continue;
    }
    // Dedup on the normalized E.164 form so "9876543210", "+919876543210" and
    // "09876543210" collapse to one. Fall back to digits-only if normalize fails.
    const key = normalizePhone(phone) || phone.replace(/\D+/g, "");
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);

    const name = hadHeader
      ? nIdx >= 0
        ? cols[nIdx] || undefined
        : undefined
      : cols.slice(1).join(",").trim() || undefined; // no-header: rest of the line is the name
    const email = eIdx >= 0 ? cols[eIdx] || undefined : undefined;
    rows.push({ phone, name, email });
  }

  return {
    rows,
    stats: { totalRows: dataLines.length, loaded: rows.length, noPhone, duplicates, hadHeader },
  };
}
