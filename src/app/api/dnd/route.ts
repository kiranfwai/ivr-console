import { NextRequest, NextResponse } from "next/server";
import { addDnd, removeDnd, listDnd } from "@/lib/dnd";

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

// Split a pasted blob into candidate numbers: newline / comma / semicolon / space.
function parseText(text: string): string[] {
  return String(text || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function collectPhones(body: any): string[] {
  const out: string[] = [];
  if (Array.isArray(body?.phones)) out.push(...body.phones.map((p: unknown) => String(p)));
  if (typeof body?.text === "string") out.push(...parseText(body.text));
  if (typeof body?.phone === "string") out.push(body.phone);
  return out;
}

export async function GET() {
  const numbers = await listDnd();
  return NextResponse.json({ numbers, count: numbers.length });
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
