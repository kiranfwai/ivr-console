import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getClientBillingDetails, setClientBillingDetails } from "@/lib/invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The customer's own billing identity — the name, GSTIN and address that appear
 * on their invoices. Optional by design: leaving it blank never blocks a payment,
 * it only means invoices are issued to an unregistered buyer.
 *
 * Already-issued invoices do not change when this does; each one snapshots the
 * details as they were on the day it was raised.
 */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ details: await getClientBillingDetails(clientId) });
}

export async function PUT(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const details = await setClientBillingDetails(clientId, {
      legalName: body.legalName,
      gstin: body.gstin,
      address: body.address,
      state: body.state,
      stateCode: body.stateCode,
    });
    return NextResponse.json({ ok: true, details });
  } catch (e) {
    console.error("[wallet/billing-details] failed:", e);
    return NextResponse.json({ error: "Could not save billing details." }, { status: 503 });
  }
}
