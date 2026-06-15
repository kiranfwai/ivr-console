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

  // Pool size matters for the bulk-call worker: at high concurrency, claims +
  // per-call record writes + Plivo hangup callbacks all draw connections. Default
  // 25; override with PGPOOL_MAX (keep below the DB's max_connections headroom).
  const max = Number(process.env.PGPOOL_MAX) || 25;
  if (conn) {
    return new Pool({ connectionString: conn, ssl, max });
  }
  return new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    ssl,
    max,
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

    -- Bulk campaigns: a per-row work-queue. Replaces the old single-JSON-blob
    -- storage so claims/updates/hangup callbacks touch one row, not the whole
    -- job, and the worker can drain with FOR UPDATE SKIP LOCKED.
    CREATE TABLE IF NOT EXISTS bulk_job (
      id           text PRIMARY KEY,
      kind         text NOT NULL DEFAULT 'call',     -- 'call' | 'whatsapp'
      campaign_id  text,
      webhook_url  text,
      concurrency  int  NOT NULL DEFAULT 30,
      delay_ms     int  NOT NULL DEFAULT 0,
      jitter_pct   int,
      status       text NOT NULL DEFAULT 'running',  -- running | paused | completed
      total        int  NOT NULL DEFAULT 0,
      created_at   timestamptz NOT NULL DEFAULT now(),
      started_at   timestamptz,
      completed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS bulk_row (
      job_id       text NOT NULL,
      idx          int  NOT NULL,
      phone        text NOT NULL,
      name         text,
      email        text,
      status       text NOT NULL DEFAULT 'pending',  -- pending|dialing|ok|failed|press1|connected|busy|no-answer|rejected|error
      call_uuid    text,
      error        text,
      hangup_cause text,
      duration_sec int,
      attempted_at timestamptz,
      PRIMARY KEY (job_id, idx)
    );
    CREATE INDEX IF NOT EXISTS bulk_row_pending  ON bulk_row (job_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS bulk_row_calluuid ON bulk_row (call_uuid) WHERE call_uuid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS bulk_job_running  ON bulk_job (status) WHERE status='running';
    CREATE INDEX IF NOT EXISTS bulk_job_created  ON bulk_job (created_at DESC);
  `;
  await pool().query(sql);
}
