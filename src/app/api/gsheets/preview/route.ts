import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { resolveTabSelection, scanSheet } from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/gsheets/preview
 *
 * "What is actually in this sheet?" — answered before a connection is saved, and
 * re-answerable for one already saved. Reads the tab and reports what a poll
 * would find: how many rows, how many usable numbers, how many unusable or
 * duplicated, and which headers it saw.
 *
 * Writes nothing, queues nobody and dials nobody. The sheet URL only ever
 * selects a tab of a Google Sheet — the request cannot point the fetch at some
 * other host, because the URL is rebuilt from the extracted sheet id.
 *
 * Body: { sheetUrl, tabName?, tabMode?, gid? } — the same fields the connection
 * form posts when saving.
 */
export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawUrl: string = (body.sheetUrl ?? body.sheetId ?? "").trim();
  if (!rawUrl) return NextResponse.json({ error: "sheetUrl is required" }, { status: 400 });

  const tab = resolveTabSelection({
    sheetUrl: rawUrl,
    tabName: body.tabName,
    tabMode: body.tabMode,
    gid: body.gid,
  });
  if (!tab.ok) return NextResponse.json({ error: tab.error }, { status: 400 });

  const scan = await scanSheet({
    // Nothing is stored, so the id only has to be stable within this scan.
    id: "preview",
    sheetId: tab.sheetId,
    tabName: tab.tabName,
    gid: tab.gid,
  });

  return NextResponse.json({
    ok: !scan.error,
    tab: { name: tab.tabName, gid: tab.gid },
    rows: scan.rows,
    usable: scan.usable,
    invalid: scan.invalid,
    blank: scan.blank,
    duplicates: scan.duplicates,
    header: scan.header,
    error: scan.error ?? null,
  });
}
