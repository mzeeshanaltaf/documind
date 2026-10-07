// Creates the app's Postgres schema once. Run from web/: pnpm tsx scripts/create-schema.ts
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import { parseDatabaseUrl } from "../src/lib/db-url";

loadEnvConfig(path.resolve(__dirname, "..", ".."));

async function main() {
  const { connectionString, schema } = parseDatabaseUrl(process.env.DATABASE_URL);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    const { rows } = await client.query(
      "select schema_name from information_schema.schemata where schema_name = $1",
      [schema],
    );
    console.log(rows.length ? `Schema "${schema}" is ready.` : `Schema "${schema}" missing!`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
