import { NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { getClientAccountNumbers } from "@/lib/numbers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The current client's own Plivo caller-ID numbers (read live from their
 * connected account). Tenant-scoped by middleware. `connected:false` means the
 * client hasn't connected a Plivo account yet — the UI shows a connect prompt.
 *
 *   GET → { connected, numbers, total, defaultFrom }
 *
 * Read-only against Plivo; never dials or bills.
 */
export async function GET() {
  const clientId = currentClientId();
  if (!clientId) {
    return NextResponse.json({ connected: false, numbers: [], total: 0, defaultFrom: "" });
  }
  try {
    return NextResponse.json(await getClientAccountNumbers(clientId));
  } catch {
    return NextResponse.json(
      { error: "Could not load numbers from Plivo. Check the connection and try again." },
      { status: 502 },
    );
  }
}
