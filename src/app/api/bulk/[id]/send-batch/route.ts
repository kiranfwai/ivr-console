import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppBatch } from "@/lib/whatsapp-batch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Send ONE batch of a WhatsApp bulk job, on demand.
 *
 * The batching, concurrency and retry live in `sendWhatsAppBatch` so that the
 * background worker can drive exactly the same path for scheduled and
 * unattended sends. This endpoint remains for the live UI, which paces itself
 * while somebody is watching a send run.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as any));
  const r = await sendWhatsAppBatch(params.id, {
    webhookUrl: body?.webhookUrl,
    n: body?.n,
    concurrency: body?.concurrency,
  });

  if (r.error === "not found") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ done: r.done, claimed: r.claimed, sent: r.sent, failed: r.failed });
}
