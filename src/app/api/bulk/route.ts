import { NextRequest, NextResponse } from "next/server";
import { createBulkJob, listBulkJobs } from "@/lib/bulk";
import { getCampaign } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await listBulkJobs() });
}

export async function POST(req: NextRequest) {
  const { kind = "call", campaignId, webhookUrl, rows, delayMs, jitterPct } = await req.json();
  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "rows required" }, { status: 400 });
  }

  if (kind === "call") {
    if (!campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });
    const c = await getCampaign(campaignId);
    if (!c) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const job = await createBulkJob({
    kind,
    campaignId,
    webhookUrl,
    rows: rows.map((r: any) => ({ phone: String(r.phone || ""), name: r.name })),
    delayMs: typeof delayMs === "number" ? delayMs : 2000,
    jitterPct: typeof jitterPct === "number" ? jitterPct : undefined,
  });
  return NextResponse.json({ job });
}
