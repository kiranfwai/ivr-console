import { NextRequest, NextResponse } from "next/server";
import { deleteAudio } from "@/lib/audios";

export const dynamic = "force-dynamic";

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await deleteAudio(params.id);
  return NextResponse.json({ ok: true });
}
