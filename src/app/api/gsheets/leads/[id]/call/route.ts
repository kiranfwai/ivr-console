import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { triggerLeadCallById } from "@/lib/gsheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/gsheets/leads/[id]/call — manually trigger a call for one queued/failed lead. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const result = await triggerLeadCallById(clientId, id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
