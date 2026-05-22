import { NextRequest, NextResponse } from "next/server";
import { getBulkJob, deleteBulkJob } from "@/lib/bulk";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const job = await getBulkJob(params.id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteBulkJob(params.id);
  return NextResponse.json({ ok: true });
}
