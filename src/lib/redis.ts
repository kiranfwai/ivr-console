import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

/**
 * Vercel's Upstash marketplace integration creates env vars with the user's chosen
 * prefix doubled with Vercel's own suffix (e.g. `<PREFIX>_KV_REST_API_URL`).
 * Resolve from any common naming so the same code works whether someone uses raw
 * Upstash console, Vercel marketplace, or a custom prefix.
 */
function resolveCreds(): { url?: string; token?: string } {
  const env = process.env;
  const url =
    env.UPSTASH_REDIS_REST_URL ||
    env.KV_REST_API_URL ||
    findEnvBySuffix(env, "_KV_REST_API_URL") ||
    findEnvBySuffix(env, "_REST_API_URL") ||
    findEnvBySuffix(env, "_REST_URL");
  const token =
    env.UPSTASH_REDIS_REST_TOKEN ||
    env.KV_REST_API_TOKEN ||
    findEnvBySuffix(env, "_KV_REST_API_TOKEN") ||
    findEnvBySuffix(env, "_REST_API_TOKEN") ||
    findEnvBySuffix(env, "_REST_TOKEN");
  return { url, token };
}

function findEnvBySuffix(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  for (const k of Object.keys(env)) {
    if (k.endsWith(suffix) && !k.includes("READ_ONLY")) return env[k];
  }
  return undefined;
}

export function redis(): Redis {
  if (_redis) return _redis;
  const { url, token } = resolveCreds();
  if (!url || !token) {
    throw new Error(
      "Upstash Redis not configured. Expected UPSTASH_REDIS_REST_URL + _TOKEN, KV_REST_API_URL + _TOKEN, or the Vercel marketplace integration."
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
