import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone";
import { updateBulkRow } from "@/lib/bulk";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, name, email, webhookUrl, extra, bulkJobId, bulkRowIndex } = await req.json();
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const hook = webhookUrl || process.env.PABBLY_WEBHOOK_URL;
  if (!hook) return NextResponse.json({ error: "no webhook configured" }, { status: 500 });

  // Normalize so every input form maps to the SAME WhatsApp number: bare
  // 10-digit ("9876543210"), with country code ("919876543210"), E.164 ("+91…"),
  // and leading-trunk-0 ("09876543210") all become country-coded digits. We keep
  // the digits-only (no "+") convention Pabbly already receives.
  const waPhone = normalizePhone(String(phone)).replace(/^\+/, "");
  const payload: any = {
    phone: waPhone,
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
