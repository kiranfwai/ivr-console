import { NextRequest, NextResponse } from "next/server";
import { getGlobalPricing, setGlobalPricing } from "@/lib/pricing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only (enforced in middleware): read / set the global default call cost.

export async function GET() {
  const pricing = await getGlobalPricing();
  return NextResponse.json({ pricing });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pricing = await setGlobalPricing(body);
  return NextResponse.json({ pricing });
}
