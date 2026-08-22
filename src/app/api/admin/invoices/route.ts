import { NextRequest, NextResponse } from "next/server";
import { listInvoices } from "@/lib/invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — every invoice, or one client's with ?client=. Admin-only. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client") || undefined;
  const limit = Number(url.searchParams.get("limit") || "500");
  try {
    return NextResponse.json({ invoices: await listInvoices({ clientId, limit }) });
  } catch (e) {
    console.error("[admin/invoices] failed:", e);
    return NextResponse.json({ error: "Could not load invoices." }, { status: 503 });
  }
}
