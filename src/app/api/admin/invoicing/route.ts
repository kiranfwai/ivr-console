import { NextRequest, NextResponse } from "next/server";
import {
  getSellerSettings, setSellerSettings, missingSellerFields, canIssue, backfillInvoices,
} from "@/lib/invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Your own invoicing identity — the details printed on every tax invoice.
 * Admin-only (the whole /api/admin prefix is).
 *
 * Nothing is invented here: until these are filled in and `enabled` is set, no
 * invoice is issued at all. Payments keep working throughout; the invoices for
 * them can be back-filled with POST once the details are in.
 */
export async function GET() {
  const settings = await getSellerSettings();
  return NextResponse.json({
    settings,
    missing: missingSellerFields(settings),
    issuing: canIssue(settings),
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const settings = await setSellerSettings(body);
    return NextResponse.json({
      ok: true,
      settings,
      missing: missingSellerFields(settings),
      issuing: canIssue(settings),
    });
  } catch (e) {
    console.error("[admin/invoicing] save failed:", e);
    return NextResponse.json({ error: "Could not save invoicing settings." }, { status: 503 });
  }
}

/** POST — issue invoices for payments taken before invoicing was configured. */
export async function POST(req: NextRequest) {
  const limit = Number(new URL(req.url).searchParams.get("limit") || "200");
  try {
    const settings = await getSellerSettings();
    if (!canIssue(settings)) {
      return NextResponse.json(
        { error: "Fill in your invoicing details and switch invoicing on first.", missing: missingSellerFields(settings) },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, ...(await backfillInvoices(limit)) });
  } catch (e) {
    console.error("[admin/invoicing] backfill failed:", e);
    return NextResponse.json({ error: "Could not back-fill invoices." }, { status: 503 });
  }
}
