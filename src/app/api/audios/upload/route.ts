import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { createAudio } from "@/lib/audios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN not configured. Use 'Paste URL' instead, or add the env var on Vercel." },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const label = String(form.get("label") || "Untitled");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "_").toLowerCase();
  const blob = await put(`audios/${Date.now()}-${safeName}`, file, {
    access: "public",
    contentType: file.type || "audio/mpeg",
  });

  const audio = await createAudio({ label, url: blob.url, source: "blob" });
  return NextResponse.json({ audio });
}
