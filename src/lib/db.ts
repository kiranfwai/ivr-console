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
  // per-call record writes + Plivo hangup callbacks all draw connections. With
  // up to `concurrency` fireOne()s running in parallel (default 50), a pool of
  // 25 caps real DB throughput and bottlenecks dialing — half the calls block
  // waiting for a connection. Default 50; override with PGPOOL_MAX (keep below
  // the DB's max_connections headroom — vanilla Postgres allows 100).
  const max = Number(process.env.PGPOOL_MAX) || 50;
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
      status       text NOT NULL DEFAULT 'pending',  -- pending|dialing|ok|failed|press1|connected|busy|no-answer|rejected|error|dnd
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

    -- Multi-tenant: bulk jobs belong to a client so the worker can re-establish
    -- that client's data scope while dialing, and each client only sees its own
    -- jobs. NULL = a legacy job created before tenancy (admin-owned).
    ALTER TABLE bulk_job ADD COLUMN IF NOT EXISTS client_id text;
    CREATE INDEX IF NOT EXISTS bulk_job_client ON bulk_job (client_id);

    -- Why a job is paused. NULL / '' = a user-initiated Stop (stays paused until
    -- the user resumes). 'low_balance' = the worker auto-paused it because the
    -- wallet couldn't cover a call; the worker auto-resumes these once the balance
    -- recovers, so a top-up un-sticks the campaign without a manual Resume.
    ALTER TABLE bulk_job ADD COLUMN IF NOT EXISTS paused_reason text;
    CREATE INDEX IF NOT EXISTS bulk_job_gated ON bulk_job (paused_reason)
      WHERE status='paused' AND paused_reason='low_balance';

    -- Client logins. The admin is env-based (ADMIN_EMAIL / ADMIN_PASSWORD); every
    -- other login is a row here. perms is the JSON array of feature-tab ids the
    -- admin has granted this client (e.g. dial, bulk, reports).
    CREATE TABLE IF NOT EXISTS app_client (
      id          text PRIMARY KEY,
      name        text NOT NULL,
      email       text UNIQUE NOT NULL,
      pass_hash   text NOT NULL,
      pass_salt   text NOT NULL,
      perms       jsonb NOT NULL DEFAULT '[]'::jsonb,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Per-client call-cost overrides (NULL = fall back to the global default in
    -- app_config). perCall is charged per placed call; perMin per connected
    -- minute. The admin defines these; the client never sets them.
    ALTER TABLE app_client ADD COLUMN IF NOT EXISTS per_call_cost double precision;
    ALTER TABLE app_client ADD COLUMN IF NOT EXISTS per_min_cost  double precision;

    -- Per-client override for the flat per-CONNECTED-CALL charge (the live wallet
    -- billing model). NULL = inherit the global default in app_config('pricing').
    ALTER TABLE app_client ADD COLUMN IF NOT EXISTS per_conn_call_cost double precision;

    -- Per-client Plivo account. When a client connects their OWN Plivo account,
    -- their numbers listing AND their outbound calls run through these creds; when
    -- these are NULL the client falls back to the shared account (PLIVO_* env), so
    -- existing clients are unchanged. plivo_from_number is the client's default
    -- caller-ID (must be one of their own Plivo numbers).
    ALTER TABLE app_client ADD COLUMN IF NOT EXISTS plivo_auth_id     text;
    ALTER TABLE app_client ADD COLUMN IF NOT EXISTS plivo_auth_token  text;
    ALTER TABLE app_client ADD COLUMN IF NOT EXISTS plivo_from_number text;

    -- Global admin settings (key/value). Holds the default call-cost pricing at
    -- key 'pricing' and Cashfree config at key 'cashfree'. Admin-scoped only;
    -- never tenant-partitioned.
    CREATE TABLE IF NOT EXISTS app_config (
      k  text PRIMARY KEY,
      v  jsonb NOT NULL
    );

    -- Per-client prepaid wallet balance in ₹. One row per client, created lazily
    -- on first credit/charge. This is real money the client has topped up (via
    -- Cashfree) minus what their connected calls have consumed. Keyed by client
    -- id; NOT tenant-partitioned (it's the mapping the admin manages).
    CREATE TABLE IF NOT EXISTS client_wallet (
      client_id   text PRIMARY KEY,
      balance     double precision NOT NULL DEFAULT 0,
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    -- Wallet ledger: every credit/charge/adjustment/refund, newest-last by id.
    -- ref makes writes idempotent — a charge's ref is the call id (never bill a
    -- call twice on webhook retries), a topup's ref is the Cashfree order id.
    CREATE TABLE IF NOT EXISTS wallet_txn (
      id            bigserial PRIMARY KEY,
      client_id     text NOT NULL,
      type          text NOT NULL,            -- topup | charge | adjustment | refund
      amount        double precision NOT NULL, -- signed ₹: +credit, -charge
      balance_after double precision NOT NULL,
      description   text NOT NULL DEFAULT '',
      ref           text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS wallet_txn_ref
      ON wallet_txn (client_id, type, ref) WHERE ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS wallet_txn_client
      ON wallet_txn (client_id, created_at DESC);

    -- Pending/paid Cashfree top-up orders. Maps an order back to the client +
    -- amount so the webhook (which only carries the order id) can credit the
    -- right wallet. status: created | paid | failed.
    CREATE TABLE IF NOT EXISTS wallet_order (
      order_id    text PRIMARY KEY,
      client_id   text NOT NULL,
      amount      double precision NOT NULL,
      status      text NOT NULL DEFAULT 'created',
      created_at  timestamptz NOT NULL DEFAULT now(),
      paid_at     timestamptz
    );
    CREATE INDEX IF NOT EXISTS wallet_order_client ON wallet_order (client_id, created_at DESC);
  `;
  await pool().query(sql);
}
