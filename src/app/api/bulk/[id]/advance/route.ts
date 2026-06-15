import { NextRequest, NextResponse } from "next/server";
import { countPending } from "@/lib/bulk";
import { startWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Deprecated. Calls are now driven entirely by the in-process worker
 * (src/lib/worker.ts). This endpoint is kept only so any old client doesn't 404;
 * it just ensures the worker is running and reports whether the job is drained.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await startWorker();
  const pending = await countPending(params.id);
  return NextResponse.json({ done: pending === 0, claimed: 0, ok: 0, failed: 0, deprecated: true });
}
