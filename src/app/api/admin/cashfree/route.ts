import { NextRequest, NextResponse } from "next/server";
import { getConfigPublic, setConfig, clearConfig } from "@/lib/cashfree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Admin-only (enforced in middleware): read / set / clear Cashfree credentials.
// The secret key is write-only — GET never returns it, only whether it's set.

export async function GET() {
  return NextResponse.json({ config: await getConfigPublic() });
}

// Wipe the stored App ID + secret so a new one can be entered from scratch.
export async function DELETE() {
  return NextResponse.json({ config: await clearConfig() });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const config = await setConfig({
    env: body.env,
    appId: body.appId,
    // Blank/omitted secret keeps the stored one (so env/appId can change alone).
    secretKey: body.secretKey,
  });
  return NextResponse.json({ config });
}
