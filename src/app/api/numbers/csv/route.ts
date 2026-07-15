import { currentClientId } from "@/lib/tenant";
import { getClientAccountNumbers } from "@/lib/numbers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CSV export of the current client's own Plivo numbers. Tenant-scoped. */
const HEADER = ["number", "type", "country", "region", "voice", "sms", "monthlyRentalRate", "addedOn", "default"];

function csvEscape(v: any): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const clientId = currentClientId();
  const data = clientId ? await getClientAccountNumbers(clientId).catch(() => null) : null;
  const numbers = data?.numbers ?? [];

  const lines = [HEADER.join(",")];
  for (const n of numbers) {
    lines.push(
      [
        n.e164, n.numberType, n.country, n.region, n.voiceEnabled ? "yes" : "no",
        n.smsEnabled ? "yes" : "no", n.monthlyRentalRate, n.addedOn, n.isDefault ? "yes" : "",
      ].map(csvEscape).join(","),
    );
  }

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-numbers.csv"`,
    },
  });
}
