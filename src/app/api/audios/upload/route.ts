import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createAudio } from "@/lib/audios";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || "ap-southeast-1";

  if (!bucket) {
    return NextResponse.json(
      { error: "No S3 bucket configured. Set S3_BUCKET (and AWS_REGION), or use 'Paste URL' instead." },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const label = String(form.get("label") || "Untitled");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  // Enforce the 10 MB / MP3-WAV limits server-side too (FEATURE 5).
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Audio file too large — the maximum is 10 MB." }, { status: 413 });
  }
  if (!/\.(mp3|wav)$/i.test(file.name) && !/^audio\/(mpeg|mp3|wav|x-wav|wave|vnd\.wave)$/i.test(file.type)) {
    return NextResponse.json({ error: "Only MP3 or WAV audio files are supported." }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "_").toLowerCase();
  const key = `audios/${Date.now()}-${safeName}`;

  try {
    const body = Buffer.from(await file.arrayBuffer());
    const s3 = new S3Client({ region });
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: file.type || "audio/mpeg",
      })
    );
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    const audio = await createAudio({ label, url, source: "url" });
    return NextResponse.json({ audio });
  } catch (e) {
    console.error("[audios/upload] failed:", e);
    return NextResponse.json(
      { error: "Upload failed — could not store the file. Check S3 credentials/bucket, or use 'Paste URL'." },
      { status: 502 }
    );
  }
}