import { NextRequest, NextResponse } from "next/server";
import { listAudios, createAudio } from "@/lib/audios";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ audios: await listAudios() });
  } catch (e) {
    console.error("[audios:GET]", e);
    return NextResponse.json({ error: "Could not load audios." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    if (!/^https?:\/\//.test(body.url) && !body.url.startsWith("/")) {
      return NextResponse.json({ error: "url must be http(s) or absolute path" }, { status: 400 });
    }
    const a = await createAudio({
      label: body.label || "Untitled",
      url: body.url,
      source: body.source || "url",
    });
    return NextResponse.json({ audio: a }, { status: 201 });
  } catch (e) {
    console.error("[audios:POST]", e);
    return NextResponse.json({ error: "Could not add audio." }, { status: 500 });
  }
}
