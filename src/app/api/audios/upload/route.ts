import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { createAudio } from "@/lib/audios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function findBlobToken(): string | undefined {
  const env = process.env;
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN;
  // Vercel may prefix the token name when multiple blob stores are connected,
  // e.g. IVR_AUDIOS_READ_WRITE_TOKEN.
  for (const k of Object.keys(env)) {
    if (k.endsWith("_READ_WRITE_TOKEN") || k.endsWith("_BLOB_READ_WRITE_TOKEN")) {
      return env[k];
    }
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const token = findBlobToken();
  if (!token) {
    return NextResponse.json(
      { error: "No Vercel Blob token found. Add BLOB_READ_WRITE_TOKEN (or connect a Blob store to this project), or use 'Paste URL' instead." },
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
    token,
  });

  const audio = await createAudio({ label, url: blob.url, source: "blob" });
  return NextResponse.json({ audio });
}
