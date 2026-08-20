/**
 * Which tab of a Google Sheet a connection dials, and how it is chosen.
 *
 * Pure string handling, deliberately kept out of ./gsheets.ts: the connection
 * form is a client component, and importing anything from ./gsheets.ts would
 * drag the Postgres driver into the browser bundle with it. Both sides import
 * from here so the URL the user pastes is parsed by exactly one piece of code.
 */

/** Which spreadsheet, and which tab of it, a pasted URL refers to. */
export interface SheetTarget {
  sheetId: string;
  /** Tab id from the URL's `gid`, or null when the URL does not name a tab. */
  gid: string | null;
}

/**
 * Pull the sheet id and the tab id out of whatever the user pasted.
 *
 * The address bar of an open sheet ends in `#gid=1234567`, which identifies the
 * tab being looked at. Reading it is what lets a connection dial the tab the
 * user actually had open, instead of falling back to a tab NAMED "Sheet1" that
 * may hold something else entirely. The gid is also stable across renames,
 * which a name is not.
 *
 * Accepts the gid in the fragment (`#gid=`) or the query (`?gid=`/`&gid=`),
 * since both shapes appear in links people share.
 */
export function extractSheetTarget(urlOrId: string): SheetTarget {
  const raw = urlOrId.trim();
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = raw.match(/[#?&]gid=([0-9]+)/);
  return {
    sheetId: idMatch ? idMatch[1] : raw,
    gid: gidMatch ? gidMatch[1] : null,
  };
}

/** Extract sheet ID from a Google Sheets URL, or return the value as-is if already an ID. */
export function extractSheetId(urlOrId: string): string {
  return extractSheetTarget(urlOrId).sheetId;
}

/**
 * Work out which tab a save request means, from the URL and the caller's stated
 * intent. Shared by the create and update routes so both agree.
 *
 * `tabMode` says how the user wants the tab targeted:
 *   "gid"  — by the tab id in the URL. Refused if the URL does not carry one,
 *            because silently falling back to a name is exactly the confusion
 *            this exists to remove.
 *   "name" — by tab name, and any gid in the URL is discarded.
 *   absent — the URL decides: a gid if it has one, otherwise the name. This is
 *            what old API callers get, and it can only make them more accurate.
 */
export function resolveTabSelection(input: {
  sheetUrl: string;
  tabName?: unknown;
  tabMode?: unknown;
  gid?: unknown;
}): { ok: true; sheetId: string; tabName: string; gid: string | null } | { ok: false; error: string } {
  const target = extractSheetTarget(String(input.sheetUrl ?? ""));
  if (!target.sheetId) return { ok: false, error: "Could not parse a sheet ID from that URL" };

  const tabName = String(input.tabName ?? "Sheet1").trim() || "Sheet1";
  const explicitGid = typeof input.gid === "string" && /^[0-9]+$/.test(input.gid.trim())
    ? input.gid.trim()
    : null;
  const gidFromUrl = explicitGid ?? target.gid;
  const mode = input.tabMode === "gid" || input.tabMode === "name" ? input.tabMode : null;

  if (mode === "name") return { ok: true, sheetId: target.sheetId, tabName, gid: null };
  if (mode === "gid" && !gidFromUrl) {
    return {
      ok: false,
      error: "That link does not point at a specific tab — open the tab you want in Google Sheets and copy the URL from the address bar (it ends in #gid=…), or target the tab by name instead.",
    };
  }
  return { ok: true, sheetId: target.sheetId, tabName, gid: gidFromUrl };
}

/**
 * How a connection's tab is described to a human — the gid is exact but
 * meaningless to read, so show the label alongside it where there is one.
 */
export function describeTab(conn: { tabName: string; gid: string | null }): string {
  if (!conn.gid) return conn.tabName;
  const label = conn.tabName?.trim();
  return label && label !== "Sheet1" ? `${label} (gid ${conn.gid})` : `gid ${conn.gid}`;
}
