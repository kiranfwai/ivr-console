import { NextRequest, NextResponse } from "next/server";
import { updateBulkRow } from "@/lib/bulk";
import { buildWaPayload, postToPabbly } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, name, email, webhookUrl, extra, bulkJobId, bulkRowIndex } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const hook = webhookUrl || process.env.PABBLY_WEBHOOK_URL;
  if (!hook) return NextResponse.json({ error: "no webhook configured" }, { status: 500 });

  const payload = buildWaPayload({ phone, name, email, extra });
  // Retry + exponential backoff lives in postToPabbly so a transient 429/5xx or
  // dropped connection doesn't burn the send.
  const r = await postToPabbly(hook, payload);

  if (bulkJobId && typeof bulkRowIndex === "number") {
    await updateBulkRow(bulkJobId, bulkRowIndex, {
      status: r.ok ? "ok" : "failed",
      attemptedAt: new Date().toISOString(),
      error: r.ok ? undefined : `Pabbly ${r.status || "error"}`,
    });
  }

  return NextResponse.json({ ok: r.ok, status: r.status, ms: r.ms, attempts: r.attempts, body: r.body, payload });
}
