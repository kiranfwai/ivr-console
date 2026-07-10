import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { listTxns } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export the current client's full wallet ledger as CSV.
export async function GET(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "no client" }, { status: 400 });

  const u = new URL(req.url);
  const from = u.searchParams.get("from") || undefined;
  const to = u.searchParams.get("to") || undefined;

  const txns = await listTxns(clientId, { from, to, limit: 5000 });
  const header = ["Date", "Type", "Description", "Amount (INR)", "Balance after (INR)", "Reference"];
  const lines = [header.join(",")];
  for (const t of txns) {
    lines.push(
      [
        csvCell(t.createdAt),
        csvCell(t.type),
        csvCell(t.description),
        csvCell(t.amount.toFixed(2)),
        csvCell(t.balanceAfter.toFixed(2)),
        csvCell(t.ref ?? ""),
      ].join(","),
    );
  }
  const body = lines.join("\n");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="wallet-transactions.csv"`,
    },
  });
}
