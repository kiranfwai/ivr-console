import { NextRequest, NextResponse } from "next/server";
import { deleteAudio } from "@/lib/audios";

export const dynamic = "force-dynamic";

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteAudio(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audios/[id]:DELETE]", e);
    return NextResponse.json({ error: "Could not delete audio." }, { status: 500 });
  }
}
