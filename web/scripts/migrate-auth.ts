// Creates/updates Better Auth's tables in the configured schema.
// Run from web/: pnpm auth:migrate   (add -- --dry-run to print the SQL only)
//
// Replaces `@better-auth/cli migrate`: that CLI is deprecated (stuck at 1.4.x) and
// refuses to load a config that imports "server-only". Running under the
// `react-server` condition turns "server-only" into a no-op instead.
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(__dirname, "..", ".."));

const BETTER_AUTH_TABLES = ["user", "session", "account", "verification", "organization", "member", "invitation"];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { getMigrations } = await import("better-auth/db/migration");
  const { auth } = await import("../src/lib/auth");
  const { pool, DB_SCHEMA } = await import("../src/lib/db");

  try {
    const { toBeCreated, toBeAdded, compileMigrations, runMigrations } = await getMigrations(auth.options);
    console.log(`Schema: ${DB_SCHEMA}`);
    console.log(`Tables to create: ${toBeCreated.map((t) => t.table).join(", ") || "(none)"}`);
    console.log(
      `Columns to add: ${toBeAdded.map((t) => `${t.table}(${Object.keys(t.fields).join(", ")})`).join("; ") || "(none)"}`,
    );

    if (dryRun) {
      console.log("\n" + (await compileMigrations()));
      return;
    }
    if (toBeCreated.length || toBeAdded.length) {
      await runMigrations();
      console.log("Migrations applied.");
    } else {
      console.log("Nothing to migrate.");
    }

    const { rows } = await pool.query<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name from information_schema.tables
        where table_name = any($1::text[]) and table_schema in ($2, 'public')
        order by table_schema, table_name`,
      [BETTER_AUTH_TABLES, DB_SCHEMA],
    );
    console.log("\nBetter Auth tables found:");
    for (const r of rows) console.log(`  ${r.table_schema}.${r.table_name}`);
    if (rows.some((r) => r.table_schema === "public")) {
      console.warn("WARNING: some Better Auth tables exist in public.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
