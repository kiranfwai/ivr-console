/**
 * Turn a pasted blob of text into a list of phone numbers.
 *
 * This exists because the Do-Not-Disturb box used to split on ANY whitespace:
 *
 *     text.split(/[\s,;]+/)
 *
 * People write Indian numbers with spaces in them — "+91 88255 74083" is the
 * normal way to type one. That split shattered every such number into three
 * fragments ("+91", "88255", "74083"), stored all three, and reported
 * "Added 3 numbers" — so the paste looked like it worked while blocking
 * nothing. On a DND list that means calling someone who asked you not to.
 *
 * The rule here is: a LINE (or comma-separated field) is one number, unless it
 * plainly holds more than one.
 *
 * "Plainly holds more than one" is decided by digit count, because no real
 * phone number exceeds 15 digits (ITU-T E.164). A chunk longer than that is
 * carrying several numbers, and we then split it — preferring "+" boundaries
 * over spaces, so "+91 88255 74083 +91 98200 38609" still comes apart into two
 * numbers rather than six fragments.
 *
 * There is one genuinely ambiguous input this cannot resolve: several numbers
 * on one line, with internal spaces and no "+" prefixes. Nothing can tell
 * "98200 38609 87222" apart from a single long number without knowing the
 * dialling plan. Line-per-number and comma-separated both work; that one does
 * not, and it fails by splitting rather than by silently storing junk.
 */

/** E.164 caps a subscriber number at 15 digits, country code included. */
const MAX_E164_DIGITS = 15;

function digitCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch >= "0" && ch <= "9") n++;
  return n;
}

/**
 * Split a chunk that is too long to be a single number.
 * Prefers "+" boundaries, because a "+" can only start a number.
 */
function splitOverlongChunk(chunk: string): string[] {
  const plusParts = chunk
    .split(/(?=\+)/g)
    .map((p) => p.trim())
    .filter((p) => digitCount(p) > 0);

  // Splitting on "+" only helped if it actually produced more than one piece
  // AND each piece is now a plausible single number.
  if (plusParts.length > 1 && plusParts.every((p) => digitCount(p) <= MAX_E164_DIGITS)) {
    return plusParts;
  }

  // Otherwise fall back to whitespace. This is the old behaviour, but it now
  // only runs on a chunk we already know holds more than one number.
  return chunk
    .split(/\s+/g)
    .map((p) => p.trim())
    .filter((p) => digitCount(p) > 0);
}

/**
 * Parse pasted text into raw phone strings, in the order they appeared.
 *
 * Returned strings are NOT normalized — callers run them through
 * `normalizePhone`, which is what decides the stored/dialled form.
 */
export function parsePhoneList(text: string): string[] {
  const out: string[] = [];

  // Rows first: newlines, commas, semicolons, tabs and pipes separate entries.
  // Spaces deliberately do NOT, because they occur *inside* numbers.
  const chunks = String(text || "").split(/[\r\n,;\t|]+/g);

  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const digits = digitCount(chunk);
    if (digits === 0) continue; // a name, a header, an email — nothing to dial

    if (digits <= MAX_E164_DIGITS) {
      out.push(chunk);
      continue;
    }

    for (const part of splitOverlongChunk(chunk)) out.push(part);
  }

  return out;
}
