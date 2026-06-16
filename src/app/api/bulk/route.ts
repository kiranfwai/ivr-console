import { NextRequest, NextResponse } from "next/server";
import { createBulkJob, getJobWithCounts, listBulkJobs } from "@/lib/bulk";
import { getCampaign } from "@/lib/campaigns";
import { startWorker } from "@/lib/worker";
import { createLimiter, BusyError } from "@/lib/limiter";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Inserting up to ~30k recipient rows (chunked, per-chunk commit) must never time
// out on a slow DB. Give the upload endpoint generous headroom (BUG 4 / BUG 5).
export const maxDuration = 120;

// Hard ceiling on rows per upload — reject clearly instead of OOM/timeout (BUG 5).
// Matches the dashboard's 30k cap (FEATURE 4); "Split & upload" stays under it.
const MAX_BULK_ROWS = Number(process.env.MAX_BULK_ROWS) || 30000;

// Serialize upload processing so concurrent large uploads can't exhaust the DB
// pool and 500/503 the whole box. At most N at once, with a bounded wait queue.
const uploadLimiter = createLimiter(
  Number(process.env.UPLOAD_CONCURRENCY) || 2,
  Number(process.env.UPLOAD_QUEUE_MAX) || 20,
);

const busy = (msg: string) =>
  NextResponse.json({ error: msg }, { status: 503, headers: { "Retry-After": "10" } });

export async function GET() {
  try {
    return NextResponse.json({ jobs: await listBulkJobs() });
  } catch (e) {
    console.error("[bulk] list failed:", e);
    return busy("Server busy loading campaigns. Retry in a moment.");
  }
}

export async function POST(req: NextRequest) {
  // Body parse — a truncated/oversized/garbled upload should read as a clear 400,
  // never a bare 500. (A body over nginx's client_max_body_size 413s before it
  // reaches here; the frontend maps that to "File too large".)
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid CSV format — the upload could not be read." },
      { status: 400 },
    );
  }

  const { kind = "call", campaignId, webhookUrl, rows, delayMs, jitterPct, concurrency, idempotencyKey } = body || {};

  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: "No valid contacts found in the upload." }, { status: 400 });
  }
  if (rows.length > MAX_BULK_ROWS) {
    return NextResponse.json(
      {
        error: `Too many contacts (${rows.length.toLocaleString()}). Max ${MAX_BULK_ROWS.toLocaleString()} per upload — split into smaller batches.`,
      },
      { status: 413 },
    );
  }

  if (kind === "call") {
    if (!campaignId) return NextResponse.json({ error: "Pick a campaign first." }, { status: 400 });
    const c = await getCampaign(campaignId).catch(() => null);
    if (!c) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  // Idempotency: a retried upload (same key, after a 503/504/network blip) must
  // not create a duplicate job. If we already minted one for this key, return it.
  if (idempotencyKey) {
    const existing = await redis().get<string>(`bulkidem:${idempotencyKey}`).catch(() => null);
    if (existing) {
      const job = await getJobWithCounts(existing).catch(() => null);
      if (job) return NextResponse.json({ job, idempotent: true });
    }
  }

  try {
    const job = await uploadLimiter(() =>
      createBulkJob({
        kind,
        campaignId,
        webhookUrl,
        rows: rows.map((r: any) => ({ phone: String(r.phone || ""), name: r.name, email: r.email || undefined })),
        delayMs: typeof delayMs === "number" ? delayMs : 0,
        jitterPct: typeof jitterPct === "number" ? jitterPct : undefined,
        concurrency: typeof concurrency === "number" ? concurrency : undefined,
      }),
    );

    if (idempotencyKey) {
      await redis().set(`bulkidem:${idempotencyKey}`, job.id, { ex: 2 * 60 * 60 }).catch(() => {});
    }
    // Ensure the backend worker is running even if the boot hook didn't fire.
    if (kind === "call") await startWorker().catch(() => {});
    return NextResponse.json({ job });
  } catch (e) {
    if (e instanceof BusyError) {
      return busy("Server busy — too many uploads at once. Retry in 10s.");
    }
    console.error("[bulk] create failed:", e);
    return busy("Could not save the campaign — the database is busy. Retry in a few seconds.");
  }
}
