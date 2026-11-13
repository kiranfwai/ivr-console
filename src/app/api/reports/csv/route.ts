import { NextRequest } from "next/server";
import { listCampaigns } from "@/lib/campaigns";
import { buildCallsCsv, listCallsForCampaigns } from "@/lib/report-export";
import { parseCampaignIds, slug } from "@/lib/report-format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Call report CSV — one row per call, friendly columns (see CSV_COLUMNS).
 *
 * GET ?from=yyyy-mm-dd&to=yyyy-mm-dd&campaigns=id1,id2
 *   - `campaigns` takes one or many ids; the older single `campaign=` still works.
 *   - no campaign = every campaign in the range.
 *   - `day=` (single day) is still accepted.
 * Dates are IST calendar days. The body starts with a UTF-8 BOM so Excel shows ₹.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || undefined;
  const from = day || url.searchParams.get("from") || undefined;
  const to = day || url.searchParams.get("to") || from;
  const campaignIds = parseCampaignIds(url.searchParams);

  // Row-level export must materialize records (unlike the counter-based KPIs).
  // Cap to keep the function within memory/time limits; narrow the range for more.
  const EXPORT_CAP = 50000;
  let body: string;
  let rows = 0;
  try {
    const calls = await listCallsForCampaigns({ limit: EXPORT_CAP, day, from, to, campaignIds });
    rows = calls.length;
    if (calls.length >= EXPORT_CAP) {
      console.warn(`[reports/csv] export hit ${EXPORT_CAP}-row cap for range ${from}..${to}`);
    }
    body = await buildCallsCsv(calls);
  } catch (e) {
    console.error("[reports/csv] export failed:", e);
    return new Response("Export failed — the database is busy. Try a narrower range.", { status: 503 });
  }

  // call-report_<from>_to_<to>_<campaign-or-N-campaigns>.csv
  let which = "all-campaigns";
  if (campaignIds.length === 1) {
    const campaigns = await listCampaigns().catch(() => []);
    const name = campaigns.find((c) => c.id === campaignIds[0])?.name;
    which = slug(name || campaignIds[0]);
  } else if (campaignIds.length > 1) {
    which = `${campaignIds.length}-campaigns`;
  }
  const range = from ? `${from}_to_${to || from}` : "all-dates";
  const filename = `call-report_${range}_${which}.csv`.replace(/[^A-Za-z0-9._-]/g, "-");

  return new Response("﻿" + body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Row-Count": String(rows),
      "Cache-Control": "no-store",
    },
  });
}
