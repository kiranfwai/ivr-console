import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getInvoice } from "@/lib/invoice";
import { renderInvoicePdf, invoiceFileName } from "@/lib/invoice-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — download one of this client's own invoices as a PDF. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  try {
    const inv = await getInvoice(id);
    // Answer 404 rather than 403 for someone else's invoice — a client should not
    // be able to learn that an invoice id exists on another account.
    if (!inv || inv.clientId !== clientId) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const pdf = await renderInvoicePdf(inv);
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceFileName(inv)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[wallet/invoices/pdf] failed:", e);
    return NextResponse.json({ error: "Could not build the invoice." }, { status: 503 });
  }
}
