import { redis, newId } from "./redis";
import type { Audio } from "./models";

const KEY = (id: string) => `audio:${id}`;
const INDEX = "audios:index";

export async function listAudios(): Promise<Audio[]> {
  const r = redis();
  const ids = (await r.smembers(INDEX)) as string[];
  if (!ids.length) return [];
  const rows = await Promise.all(ids.map((id) => r.get<Audio>(KEY(id))));
  return rows
    .filter((x): x is Audio => !!x)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getAudio(id: string): Promise<Audio | null> {
  return (await redis().get<Audio>(KEY(id))) ?? null;
}

export async function createAudio(input: { label: string; url: string; source?: "url" | "blob" }): Promise<Audio> {
  const a: Audio = {
    id: newId("aud"),
    label: input.label || "Untitled",
    url: input.url,
    source: input.source || "url",
    createdAt: new Date().toISOString(),
  };
  const r = redis();
  await r.set(KEY(a.id), a);
  await r.sadd(INDEX, a.id);
  return a;
}

export async function deleteAudio(id: string): Promise<void> {
  const r = redis();
  await r.del(KEY(id));
  await r.srem(INDEX, id);
}
