import { NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { listInvoices } from "@/lib/invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — this client's tax invoices, newest first. */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ invoices: await listInvoices({ clientId }) });
  } catch (e) {
    console.error("[wallet/invoices] failed:", e);
    return NextResponse.json({ error: "Could not load invoices." }, { status: 503 });
  }
}
