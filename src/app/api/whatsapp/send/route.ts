import { NextRequest, NextResponse } from "next/server";
import { digitsOnly } from "@/lib/phone";
import { updateBulkRow } from "@/lib/bulk";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, name, email, webhookUrl, extra, bulkJobId, bulkRowIndex } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const hook = webhookUrl || process.env.PABBLY_WEBHOOK_URL;
  if (!hook) return NextResponse.json({ error: "no webhook configured" }, { status: 500 });

  const payload: any = {
    phone: digitsOnly(String(phone)),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(extra || {}),
  };

  const t0 = Date.now();
  let ok = false;
  let status = 0;
  let body = "";
  try {
    const r = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status = r.status;
    body = await r.text();
    ok = r.ok;
  } catch (e: any) {
    body = String(e);
  }
  const ms = Date.now() - t0;

  if (bulkJobId && typeof bulkRowIndex === "number") {
    await updateBulkRow(bulkJobId, bulkRowIndex, {
      status: ok ? "ok" : "failed",
      attemptedAt: new Date().toISOString(),
      error: ok ? undefined : `Pabbly ${status || "error"}`,
    });
  }

  return NextResponse.json({ ok, status, ms, body: body.slice(0, 500), payload });
}
