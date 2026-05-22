import { redis, newId } from "./redis";
import type { Campaign } from "./models";

const KEY = (id: string) => `campaign:${id}`;
const INDEX = "campaigns:index";

export async function listCampaigns(): Promise<Campaign[]> {
  const r = redis();
  const ids = (await r.smembers(INDEX)) as string[];
  if (!ids.length) return [];
  const rows = await Promise.all(ids.map((id) => r.get<Campaign>(KEY(id))));
  return rows
    .filter((x): x is Campaign => !!x)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return (await redis().get<Campaign>(KEY(id))) ?? null;
}

export interface CampaignInput {
  name: string;
  audioId?: string | null;
  prompt?: string;
  webhookUrl?: string;
  fromNumber?: string;
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const c: Campaign = {
    id: newId("cmp"),
    name: input.name,
    audioId: input.audioId ?? null,
    prompt: input.prompt ?? "Press 1 to receive your WhatsApp message.",
    webhookUrl: input.webhookUrl ?? "",
    fromNumber: input.fromNumber ?? "",
    createdAt: new Date().toISOString(),
  };
  const r = redis();
  await r.set(KEY(c.id), c);
  await r.sadd(INDEX, c.id);
  return c;
}

export async function updateCampaign(id: string, patch: Partial<CampaignInput>): Promise<Campaign | null> {
  const r = redis();
  const cur = await r.get<Campaign>(KEY(id));
  if (!cur) return null;
  const next: Campaign = {
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.audioId !== undefined ? { audioId: patch.audioId } : {}),
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    ...(patch.webhookUrl !== undefined ? { webhookUrl: patch.webhookUrl } : {}),
    ...(patch.fromNumber !== undefined ? { fromNumber: patch.fromNumber } : {}),
  };
  await r.set(KEY(id), next);
  return next;
}

export async function deleteCampaign(id: string): Promise<void> {
  const r = redis();
  await r.del(KEY(id));
  await r.srem(INDEX, id);
}
