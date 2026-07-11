#!/usr/bin/env node
// Convert the virtual "Pryank" (the admin's pre-tenancy / tenant-less data) into
// a REAL client account, without changing any of its data or behaviour.
//
// What it does, in ONE transaction:
//   1. Creates an app_client row (email + scrypt password + perms) — same shape
//      as the admin "New client" flow (see src/lib/clients.ts).
//   2. Re-tenants every tenant-less data key by prefixing it with `t:<cid>:`
//      across the kv / zset / sset / hash tables (this is exactly what the app's
//      scopeKey() would have written had the data been created under the client).
//   3. Assigns the client's pre-tenancy bulk jobs (bulk_job.client_id IS NULL).
//   4. Optionally seeds a starting wallet balance.
//
// It does NOT touch app_config (global pricing / Cashfree creds live there and
// stay global) or the wallet tables' mapping — those are keyed by client id, so
// the new client's wallet simply starts at 0 and works like any other.
//
// Usage:
//   DATABASE_URL=... \
//   PRYANK_EMAIL=pryank@example.com PRYANK_PASSWORD='••••' \
//   node scripts/convert-pryank.mjs --dry-run      # inspect what would move
//   node scripts/convert-pryank.mjs --yes          # actually run it
//
// Env:
//   DATABASE_URL / POSTGRES_URL   (or discrete PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT)
//   PGSSL=require                  (managed Postgres)
//   PRYANK_EMAIL      (required)   login email
//   PRYANK_PASSWORD   (required)   login password
//   PRYANK_NAME       (default "Pryank")
//   PRYANK_PERMS      (default "all")  comma list of: dial,bulk,campaigns,audios,reports,whatsapp,billing
//   SEED_BALANCE      (optional)   ₹ to credit the new wallet as an opening adjustment

import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const FEATURES = ["dial", "bulk", "campaigns", "audios", "reports", "whatsapp", "billing"];
const KV_TABLES = ["kv", "zset", "sset", "hash"];
const SCRYPT_KEYLEN = 64;

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run") || !args.has("--yes");

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

function newId(prefix) {
  const rand = randomBytes(4).toString("hex").slice(0, 6);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

function makePool() {
  const conn = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const ssl =
    /^(require|true|1)$/i.test(process.env.PGSSL || "") || /sslmode=require/.test(conn || "")
      ? { rejectUnauthorized: false }
      : undefined;
  if (conn) return new pg.Pool({ connectionString: conn, ssl, max: 4 });
  return new pg.Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    ssl,
    max: 4,
  });
}

async function main() {
  const email = env("PRYANK_EMAIL");
  const password = env("PRYANK_PASSWORD");
  const name = env("PRYANK_NAME", "Pryank");
  const permsRaw = env("PRYANK_PERMS", "all");
  const seed = Number(env("SEED_BALANCE", "0")) || 0;

  if (!email || !password) {
    console.error("ERROR: PRYANK_EMAIL and PRYANK_PASSWORD are required.");
    process.exit(1);
  }
  const perms =
    permsRaw.trim().toLowerCase() === "all"
      ? [...FEATURES]
      : permsRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => FEATURES.includes(s));

  const pool = makePool();
  const client = await pool.connect();
  try {
    // --- Inspect the tenant-less keyspace we're about to re-home -------------
    const prefixCounts = {};
    let totalUnprefixed = 0;
    for (const t of KV_TABLES) {
      const { rows } = await client.query(
        `SELECT split_part(k, ':', 1) AS head, count(*)::int AS n
           FROM ${t} WHERE k NOT LIKE 't:%' GROUP BY 1 ORDER BY 2 DESC`,
      );
      for (const r of rows) {
        prefixCounts[r.head] = (prefixCounts[r.head] || 0) + r.n;
        totalUnprefixed += r.n;
      }
    }
    const { rows: bulkRows } = await client.query(
      `SELECT count(*)::int AS n FROM bulk_job WHERE client_id IS NULL`,
    );
    const bulkNull = bulkRows[0]?.n ?? 0;

    console.log("=".repeat(60));
    console.log(`Tenant-less (Pryank) data to migrate:`);
    console.log(`  rows across kv/zset/sset/hash : ${totalUnprefixed}`);
    console.log(`  key namespaces                : ${Object.entries(prefixCounts).map(([k, v]) => `${k}(${v})`).join(", ") || "(none)"}`);
    console.log(`  bulk_job rows (client_id NULL): ${bulkNull}`);
    console.log("=".repeat(60));

    // Idempotency / sanity: does this email already exist?
    const existing = await client.query(`SELECT id FROM app_client WHERE email=$1`, [
      email.trim().toLowerCase(),
    ]);
    if (existing.rows.length) {
      console.error(`\nABORT: a client with email ${email} already exists (id=${existing.rows[0].id}).`);
      console.error(`If Pryank was already converted, there's nothing to do.`);
      process.exit(2);
    }

    const id = newId("cli");
    console.log(`\nNew client:`);
    console.log(`  id    : ${id}`);
    console.log(`  name  : ${name}`);
    console.log(`  email : ${email.trim().toLowerCase()}`);
    console.log(`  perms : ${perms.join(", ")}`);
    if (seed > 0) console.log(`  seed  : ₹${seed} opening wallet credit`);

    if (DRY) {
      console.log(`\n[DRY RUN] Nothing written. Re-run with --yes to apply.`);
      return;
    }

    // --- Apply, atomically ---------------------------------------------------
    const { hash, salt } = hashPassword(password);
    const prefix = `t:${id}:`;

    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO app_client (id, name, email, pass_hash, pass_salt, perms, active)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb, true)`,
        [id, name.trim() || email, email.trim().toLowerCase(), hash, salt, JSON.stringify(perms)],
      );

      let moved = 0;
      for (const t of KV_TABLES) {
        const res = await client.query(
          `UPDATE ${t} SET k = $1 || k WHERE k NOT LIKE 't:%'`,
          [prefix],
        );
        moved += res.rowCount ?? 0;
      }

      const bulkRes = await client.query(
        `UPDATE bulk_job SET client_id=$1 WHERE client_id IS NULL`,
        [id],
      );

      if (seed > 0) {
        await client.query(
          `INSERT INTO client_wallet (client_id, balance) VALUES ($1, $2)
           ON CONFLICT (client_id) DO UPDATE SET balance = client_wallet.balance + EXCLUDED.balance, updated_at = now()`,
          [id, seed],
        );
        const bal = await client.query(`SELECT balance FROM client_wallet WHERE client_id=$1`, [id]);
        await client.query(
          `INSERT INTO wallet_txn (client_id, type, amount, balance_after, description)
           VALUES ($1,'adjustment',$2,$3,'Opening balance (Pryank conversion)')`,
          [id, seed, Number(bal.rows[0].balance)],
        );
      }

      await client.query("COMMIT");
      console.log(`\n✅ Done.`);
      console.log(`   re-tenanted ${moved} data rows under ${prefix}`);
      console.log(`   assigned ${bulkRes.rowCount ?? 0} bulk_job rows to ${id}`);
      console.log(`\nNext: deploy the app (Pryank now appears as a normal client) and log in`);
      console.log(`      with ${email.trim().toLowerCase()} to verify data + wallet.`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e.message || e);
  process.exit(1);
});
