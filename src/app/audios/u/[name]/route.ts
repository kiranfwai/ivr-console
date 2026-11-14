import { stat, readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Audio uploaded with AUDIO_STORAGE=local (see /api/audios/upload). Public, like
// the rest of /audios: Plivo fetches these during calls without a session.
const DIR = process.env.AUDIO_DIR || "/data/media";
const NAME = /^\d+-[a-z0-9._-]+\.(mp3|wav)$/;

async function serve(name: string, head: boolean) {
  if (!NAME.test(name) || name.includes("..")) return new Response("Not found", { status: 404 });
  const file = path.join(DIR, name);
  try {
    const st = await stat(file);
    const headers = {
      "Content-Type": name.endsWith(".wav") ? "audio/wav" : "audio/mpeg",
      "Content-Length": String(st.size),
      // names are timestamped and never rewritten
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (head) return new Response(null, { headers });
    return new Response(await readFile(file), { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  return serve(params.name, false);
}
export async function HEAD(_req: Request, { params }: { params: { name: string } }) {
  return serve(params.name, true);
}
