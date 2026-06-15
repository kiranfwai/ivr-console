import { NextRequest, NextResponse } from "next/server";
import { getRows } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/bulk/[id]/rows
 *   ?view=failed            -> retry-able rows (no-answer/busy/error/failed), by index
 *   ?view=recent            -> most-recently attempted first (live dispatch log)
 *   ?status=ok,press1,...   -> exact statuses
 *   &limit= &offset=
 * Returns at most 500 rows so the client never loads a whole 16k-row job.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const statusParam = url.searchParams.get("status");
  const limit = Number(url.searchParams.get("limit")) || 20;
  const offset = Number(url.searchParams.get("offset")) || 0;

  const rows = await getRows(params.id, {
    retryableOnly: view === "failed",
    order: view === "recent" ? "recent" : "idx",
    statuses: statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    limit,
    offset,
  });
  return NextResponse.json({ rows });
}
