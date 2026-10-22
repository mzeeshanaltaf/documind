// Applies office/db/migrations/NNNN_*.sql to OFFICE_DB_SCHEMA, in order, once each.
//   node scripts/migrate.mjs            apply what's pending
//   node scripts/migrate.mjs --dry-run  print the pending SQL, change nothing
//
// Plain Node ESM (only `pg`), so it also runs inside the standalone image:
//   docker exec <office container> node scripts/migrate.mjs
// Each file runs in its own transaction with its schema_migrations row. `{office}` becomes
// OFFICE_DB_SCHEMA and `{auth}` DocuMind's Better Auth schema (OFFICE_AUTH_SCHEMA, else
// DATABASE_URL's `schema`). The URL handling mirrors src/lib/db-url.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "..", "db", "migrations");
const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;
const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Serializes concurrent runs (two containers starting at once). Any constant bigint works.
const LOCK_KEY = 72_000_311;

// The repo-root .env.local when present (local dev); real environment variables win.
const rootEnv = path.resolve(here, "..", "..", ".env.local");
if (fs.existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(rootEnv, "utf8")))) {
    process.env[key] ??= value;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function schemaName(value, label) {
  if (!value) fail(`${label} is not set.`);
  if (!SCHEMA_NAME.test(value)) fail(`Invalid ${label}: ${value}`);
  return value;
}

const dryRun = process.argv.includes("--dry-run");
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set.");
const url = new URL(process.env.DATABASE_URL);
const urlSchema = url.searchParams.get("schema") || "documind";
for (const param of ["schema", "connection_limit", "pool_timeout"]) url.searchParams.delete(param);

const office = schemaName(process.env.OFFICE_DB_SCHEMA, "OFFICE_DB_SCHEMA");
const authSchema = schemaName(process.env.OFFICE_AUTH_SCHEMA || urlSchema, "OFFICE_AUTH_SCHEMA");
if (office === authSchema) fail("OFFICE_DB_SCHEMA must differ from DocuMind's auth schema.");

const files = fs
  .readdirSync(migrationsDir)
  .filter((name) => MIGRATION_FILE.test(name))
  .sort();
const versions = files.map((name) => name.match(MIGRATION_FILE)[1]);
if (new Set(versions).size !== versions.length) fail("Two migrations share a version number.");

const render = (sql) => sql.replaceAll("{office}", office).replaceAll("{auth}", authSchema);

const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);

  const { rows: exists } = await client.query(
    "select 1 from information_schema.tables where table_schema = $1 and table_name = 'schema_migrations'",
    [office],
  );
  const applied = new Set();
  if (exists.length) {
    const { rows } = await client.query(`select version from ${office}.schema_migrations`);
    for (const row of rows) applied.add(row.version);
  }
  const pending = files.filter((name) => !applied.has(name.match(MIGRATION_FILE)[1]));

  console.log(`Office schema: ${office} (auth schema: ${authSchema})`);
  if (pending.length === 0) {
    console.log("Nothing to migrate.");
  } else if (dryRun) {
    if (!exists.length) {
      console.log(`\n-- bootstrap\ncreate schema if not exists ${office};`);
      console.log(`create table if not exists ${office}.schema_migrations (...);`);
    }
    for (const name of pending) {
      console.log(`\n-- ${name}\n${render(fs.readFileSync(path.join(migrationsDir, name), "utf8"))}`);
    }
    console.log(`\nDry run: ${pending.length} migration(s) pending, nothing applied.`);
  } else {
    await client.query(`create schema if not exists ${office}`);
    await client.query(
      `create table if not exists ${office}.schema_migrations (
         version text primary key,
         name text not null,
         applied_at timestamptz not null default now()
       )`,
    );
    for (const name of pending) {
      const version = name.match(MIGRATION_FILE)[1];
      await client.query("begin");
      try {
        await client.query(render(fs.readFileSync(path.join(migrationsDir, name), "utf8")));
        await client.query(`insert into ${office}.schema_migrations (version, name) values ($1, $2)`, [
          version,
          name,
        ]);
        await client.query("commit");
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`${name} failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
