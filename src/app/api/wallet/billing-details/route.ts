import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { BillingDetailsError, getClientBillingDetails, setClientBillingDetails } from "@/lib/invoice";

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
      pan: body.pan,
      address: body.address,
      line1: body.line1,
      line2: body.line2,
      city: body.city,
      pincode: body.pincode,
      state: body.state,
      stateCode: body.stateCode,
      billingEmail: body.billingEmail,
      phone: body.phone,
      shipSame: body.shipSame,
      shipLine1: body.shipLine1,
      shipLine2: body.shipLine2,
      shipCity: body.shipCity,
      shipState: body.shipState,
      shipPincode: body.shipPincode,
    });
    return NextResponse.json({ ok: true, details });
  } catch (e) {
    // Something the customer typed, and can retype — say which field, and do
    // not log it as a server fault.
    if (e instanceof BillingDetailsError) {
      return NextResponse.json({ error: e.message, field: e.field }, { status: 400 });
    }
    console.error("[wallet/billing-details] failed:", e);
    return NextResponse.json({ error: "Could not save billing details." }, { status: 503 });
  }
}
