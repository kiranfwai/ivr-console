import { NextRequest, NextResponse } from "next/server";
import { addDnd, removeDnd, listDnd, pageDnd } from "@/lib/dnd";
import { parsePhoneList } from "@/lib/phone-list";

export const dynamic = "force-dynamic";

/**
 * Per-client Do-Not-Disturb list management.
 *
 * The tenant is established by middleware (x-ivr-client header) exactly like
 * every other data route, so a client only ever reads/writes its OWN list, and
 * an admin "viewing as" a client manages that client's list. No dedicated
 * feature-permission is required — DND is available to every client.
 *
 *   GET    → { numbers: string[], count }
 *   POST   { phones: string[] } | { text: "raw pasted numbers" } → add
 *   DELETE { phones: string[] } | { all: true }                  → remove
 */


function collectPhones(body: any): string[] {
  const out: string[] = [];
  if (Array.isArray(body?.phones)) out.push(...body.phones.map((p: unknown) => String(p)));
  if (typeof body?.text === "string") out.push(...parsePhoneList(body.text));
  if (typeof body?.phone === "string") out.push(body.phone);
  return out;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Paged by default. The whole list is only ever sent when something explicitly
  // asks for it, because it can be tens of thousands of numbers long.
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "50")), 500);
  const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
  const q = url.searchParams.get("q") || "";

  const { numbers, total, matched } = await pageDnd({ limit, offset, q });
  return NextResponse.json({ numbers, count: total, total, matched, limit, offset, q });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phones = collectPhones(body);
  if (!phones.length) {
    return NextResponse.json({ error: "no phone numbers provided" }, { status: 400 });
  }
  const { added, total } = await addDnd(phones);
  return NextResponse.json({ ok: true, added, count: total });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // { all: true } clears the whole list.
  if (body?.all === true) {
    const numbers = await listDnd();
    const { removed, total } = await removeDnd(numbers);
    return NextResponse.json({ ok: true, removed, count: total });
  }

  const phones = collectPhones(body);
  if (!phones.length) {
    return NextResponse.json({ error: "no phone numbers provided" }, { status: 400 });
  }
  const { removed, total } = await removeDnd(phones);
  return NextResponse.json({ ok: true, removed, count: total });
}
