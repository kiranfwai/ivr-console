import { Pool, PoolClient } from "pg";

/**
 * Postgres connection pool + lazy schema bootstrap.
 *
 * This is the durable backing store for the IVR console (formerly Upstash Redis).
 * The Redis-shaped API in ./redis.ts is implemented on top of these four tables,
 * so the call / campaign / bulk / stats logic is unchanged — it still calls
 * redis().get/set/zadd/etc., which now read and write Postgres.
 *
 * Connection comes from DATABASE_URL (or POSTGRES_URL); falls back to discrete
 * PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT so a password containing '@' does
 * not have to be URL-encoded.
 */

let _pool: Pool | null = null;

function makePool(): Pool {
  const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  // ssl: opt-in via PGSSL=require/true (managed providers); off for plain self-hosted.
  const ssl =
    /^(require|true|1)$/i.test(process.env.PGSSL || "") ||
    /sslmode=require/.test(conn || "")
      ? { rejectUnauthorized: false }
      : undefined;

  if (conn) {
    return new Pool({ connectionString: conn, ssl, max: 10 });
  }
  return new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    ssl,
    max: 10,
  });
}

export function pool(): Pool {
  if (!_pool) _pool = makePool();
  return _pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
  await ensureSchema();
  const res = await pool().query(text, params);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw e;
  } finally {
    client.release();
  }
}

// --- schema bootstrap (idempotent, run once per process) ---------------------

let _schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!_schemaReady) {
    _schemaReady = bootstrap().catch((e) => {
      // Reset so a transient failure (e.g. DB not yet reachable) can retry.
      _schemaReady = null;
      throw e;
    });
  }
  return _schemaReady;
}

async function bootstrap(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS kv (
      k          text PRIMARY KEY,
      v          jsonb NOT NULL,
      expire_at  timestamptz
    );
    CREATE TABLE IF NOT EXISTS zset (
      k       text NOT NULL,
      member  text NOT NULL,
      score   double precision NOT NULL,
      PRIMARY KEY (k, member)
    );
    CREATE INDEX IF NOT EXISTS zset_k_score ON zset (k, score);
    CREATE TABLE IF NOT EXISTS sset (
      k       text NOT NULL,
      member  text NOT NULL,
      PRIMARY KEY (k, member)
    );
    CREATE TABLE IF NOT EXISTS hash (
      k       text NOT NULL,
      field   text NOT NULL,
      v       text NOT NULL,
      PRIMARY KEY (k, field)
    );
  `;
  await pool().query(sql);
}
