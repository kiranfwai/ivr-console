import { NextRequest, NextResponse } from "next/server";
import { getInvoice } from "@/lib/invoice";
import { renderInvoicePdf, invoiceFileName } from "@/lib/invoice-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — download any client's invoice as a PDF. Admin-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const inv = await getInvoice(id);
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
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
    console.error("[admin/invoices/pdf] failed:", e);
    return NextResponse.json({ error: "Could not build the invoice." }, { status: 503 });
  }
}
