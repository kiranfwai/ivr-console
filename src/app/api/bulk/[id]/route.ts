import { NextRequest, NextResponse } from "next/server";
import { getJobWithCounts, deleteBulkJob } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Job metadata + per-status counts. Rows are fetched separately via /rows. */
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const job = await getJobWithCounts(params.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteBulkJob(params.id);
  return NextResponse.json({ ok: true });
}
