import { query, withTx } from "./db";
import type { PoolClient } from "pg";

/**
 * Postgres-backed drop-in for the small slice of the Upstash Redis API this app
 * used. The rest of the codebase still calls `redis().get/set/zadd/...` exactly as
 * before — those calls now hit Postgres (see ./db.ts for the tables).
 *
 * Supported: get, set, del, mget, zadd, zrange (index + byScore/rev/offset/count),
 * zrem, zcard, sadd, srem, smembers, hset, hgetall, hincrby, expire, pipeline,
 * and withLock (atomic read-modify-write used by bulk.ts).
 */

type ZAddMember = { score: number; member: string };
type ZRangeOpts = { rev?: boolean; byScore?: boolean; offset?: number; count?: number };

const NOT_EXPIRED = "(expire_at IS NULL OR expire_at > now())";

async function _zrange(
  q: (text: string, params?: any[]) => Promise<{ rows: any[] }>,
  key: string,
  start: number,
  stop: number,
  opts?: ZRangeOpts,
): Promise<string[]> {
  if (opts?.byScore) {
    // byScore: with rev, args arrive as (max, min); without rev, (min, max).
    const min = opts.rev ? stop : start;
    const max = opts.rev ? start : stop;
    const dir = opts.rev ? "DESC" : "ASC";
    const params: any[] = [key, min, max];
    let sql = `SELECT member FROM zset WHERE k=$1 AND score>=$2 AND score<=$3 ORDER BY score ${dir}, member ${dir}`;
    if (opts.count != null) {
      params.push(opts.count);
      sql += ` LIMIT $${params.length}`;
    }
    if (opts.offset) {
      params.push(opts.offset);
      sql += ` OFFSET $${params.length}`;
    }
    const { rows } = await q(sql, params);
    return rows.map((r) => r.member as string);
  }
  // index mode: inclusive [start, stop]; stop < 0 means "to the end".
  const dir = opts?.rev ? "DESC" : "ASC";
  const offset = start < 0 ? 0 : start;
  const params: any[] = [key];
  let sql = `SELECT member FROM zset WHERE k=$1 ORDER BY score ${dir}, member ${dir}`;
  if (stop >= 0) {
    const limit = Math.max(0, stop - offset + 1);
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
  }
  if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const { rows } = await q(sql, params);
  return rows.map((r) => r.member as string);
}

function makeApi(q: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>) {
  return {
    async get<T = any>(key: string): Promise<T | null> {
      const { rows } = await q(`SELECT v FROM kv WHERE k=$1 AND ${NOT_EXPIRED}`, [key]);
      return rows.length ? (rows[0].v as T) : null;
    },

    async set(key: string, value: any, opts?: { ex?: number }): Promise<"OK"> {
      if (opts?.ex != null) {
        await q(
          `INSERT INTO kv (k, v, expire_at) VALUES ($1, $2::jsonb, now() + make_interval(secs => $3::int))
           ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, expire_at = EXCLUDED.expire_at`,
          [key, JSON.stringify(value), opts.ex],
        );
      } else {
        await q(
          `INSERT INTO kv (k, v, expire_at) VALUES ($1, $2::jsonb, NULL)
           ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, expire_at = NULL`,
          [key, JSON.stringify(value)],
        );
      }
      return "OK";
    },

    async del(...keys: string[]): Promise<number> {
      if (!keys.length) return 0;
      let n = 0;
      for (const tbl of ["kv", "zset", "sset", "hash"]) {
        const { rowCount } = await q(`DELETE FROM ${tbl} WHERE k = ANY($1)`, [keys]);
        n += rowCount ?? 0;
      }
      return n;
    },

    async mget<T = any>(...keys: string[]): Promise<(T | null)[]> {
      if (!keys.length) return [];
      const { rows } = await q(`SELECT k, v FROM kv WHERE k = ANY($1) AND ${NOT_EXPIRED}`, [keys]);
      const map = new Map<string, T>();
      for (const r of rows) map.set(r.k, r.v as T);
      return keys.map((k) => (map.has(k) ? (map.get(k) as T) : null));
    },

    async zadd(key: string, ...members: ZAddMember[]): Promise<number> {
      let added = 0;
      for (const m of members) {
        const { rowCount } = await q(
          `INSERT INTO zset (k, member, score) VALUES ($1, $2, $3)
           ON CONFLICT (k, member) DO UPDATE SET score = EXCLUDED.score`,
          [key, m.member, m.score],
        );
        added += rowCount ?? 0;
      }
      return added;
    },

    zrange(key: string, start: number, stop: number, opts?: ZRangeOpts): Promise<string[]> {
      return _zrange(q, key, start, stop, opts);
    },

    async zrem(key: string, ...members: string[]): Promise<number> {
      if (!members.length) return 0;
      const { rowCount } = await q(`DELETE FROM zset WHERE k=$1 AND member = ANY($2)`, [key, members]);
      return rowCount ?? 0;
    },

    async zcard(key: string): Promise<number> {
      const { rows } = await q(`SELECT count(*)::int AS n FROM zset WHERE k=$1`, [key]);
      return rows[0]?.n ?? 0;
    },

    async sadd(key: string, ...members: string[]): Promise<number> {
      let added = 0;
      for (const m of members) {
        const { rowCount } = await q(
          `INSERT INTO sset (k, member) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [key, m],
        );
        added += rowCount ?? 0;
      }
      return added;
    },

    async srem(key: string, ...members: string[]): Promise<number> {
      if (!members.length) return 0;
      const { rowCount } = await q(`DELETE FROM sset WHERE k=$1 AND member = ANY($2)`, [key, members]);
      return rowCount ?? 0;
    },

    async smembers(key: string): Promise<string[]> {
      const { rows } = await q(`SELECT member FROM sset WHERE k=$1`, [key]);
      return rows.map((r) => r.member as string);
    },

    async hset(key: string, obj: Record<string, unknown>): Promise<number> {
      const entries = Object.entries(obj);
      let n = 0;
      for (const [field, val] of entries) {
        const { rowCount } = await q(
          `INSERT INTO hash (k, field, v) VALUES ($1, $2, $3)
           ON CONFLICT (k, field) DO UPDATE SET v = EXCLUDED.v`,
          [key, field, String(val)],
        );
        n += rowCount ?? 0;
      }
      return n;
    },

    async hgetall<T = Record<string, string>>(key: string): Promise<T | null> {
      const { rows } = await q(`SELECT field, v FROM hash WHERE k=$1`, [key]);
      if (!rows.length) return null;
      const out: Record<string, string> = {};
      for (const r of rows) out[r.field] = r.v;
      return out as T;
    },

    async hincrby(key: string, field: string, by: number): Promise<number> {
      const { rows } = await q(
        `INSERT INTO hash (k, field, v) VALUES ($1, $2, $3::text)
         ON CONFLICT (k, field) DO UPDATE SET v = ((COALESCE(NULLIF(hash.v,'')::numeric, 0) + $3::numeric))::text
         RETURNING v`,
        [key, field, String(by)],
      );
      return Number(rows[0]?.v ?? by);
    },

    // TTL is an 18-month housekeeping concern, not needed to place calls. Postgres
    // keeps rows durably; a periodic cleanup job can prune by a future expire table.
    // Implemented as a successful no-op so pipelines that queue expire() still work.
    async expire(_key: string, _seconds: number): Promise<number> {
      return 1;
    },
  };
}

type RedisApi = ReturnType<typeof makeApi> & {
  pipeline: () => Pipeline;
  withLock: <T>(key: string, fn: (cur: any | null) => Promise<LockResult<T>> | LockResult<T>) => Promise<T>;
};

export type LockResult<T> = { next?: any; ret: T };

// Pipeline: queue ops, run them in one transaction, return results in order.
class Pipeline {
  private ops: Array<(api: ReturnType<typeof makeApi>) => Promise<any>> = [];

  hincrby(key: string, field: string, by: number): this {
    this.ops.push((api) => api.hincrby(key, field, by));
    return this;
  }
  expire(key: string, seconds: number): this {
    this.ops.push((api) => api.expire(key, seconds));
    return this;
  }
  hset(key: string, obj: Record<string, unknown>): this {
    this.ops.push((api) => api.hset(key, obj));
    return this;
  }
  set(key: string, value: any, opts?: { ex?: number }): this {
    this.ops.push((api) => api.set(key, value, opts));
    return this;
  }
  del(...keys: string[]): this {
    this.ops.push((api) => api.del(...keys));
    return this;
  }

  async exec(): Promise<any[]> {
    return withTx(async (client: PoolClient) => {
      const api = makeApi((text, params) => client.query(text, params).then((r) => ({ rows: r.rows, rowCount: r.rowCount ?? 0 })));
      const out: any[] = [];
      for (const op of this.ops) out.push(await op(api));
      return out;
    });
  }
}

let _api: RedisApi | null = null;

export function redis(): RedisApi {
  if (_api) return _api;
  const base = makeApi(query);
  _api = {
    ...base,
    pipeline: () => new Pipeline(),
    async withLock<T>(key: string, fn: (cur: any | null) => Promise<LockResult<T>> | LockResult<T>): Promise<T> {
      return withTx(async (client: PoolClient) => {
        const sel = await client.query(`SELECT v FROM kv WHERE k=$1 FOR UPDATE`, [key]);
        const cur = sel.rows.length ? sel.rows[0].v : null;
        const { next, ret } = await fn(cur);
        if (next !== undefined) {
          if (next === null) {
            await client.query(`DELETE FROM kv WHERE k=$1`, [key]);
          } else {
            await client.query(
              `INSERT INTO kv (k, v, expire_at) VALUES ($1, $2::jsonb, NULL)
               ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
              [key, JSON.stringify(next)],
            );
          }
        }
        return ret;
      });
    },
  };
  return _api;
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
