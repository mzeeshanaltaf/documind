// Read-only compatibility check of DocuMind's Better Auth tables against this app's config.
// Run from evaluation/web/: pnpm auth:check   (exits 1 if anything would be created or added)
//
// It NEVER migrates: DocuMind owns these tables (`pnpm auth:migrate` lives in web/ only). A
// mismatch means this app's `additionalFields` (or the Better Auth version) drifted from
// DocuMind's; fix the config here instead of altering the schema.
//
// Runs under the `react-server` condition so the `server-only` imports are no-ops.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const rootEnv = path.resolve(__dirname, "..", "..", "..", ".env.local");
if (fs.existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(rootEnv, "utf8")))) {
    process.env[key] ??= value;
  }
}

async function main() {
  const { getMigrations } = await import("better-auth/db/migration");
  const { auth } = await import("../src/lib/auth");
  const { pool, AUTH_SCHEMA } = await import("../src/lib/db");

  try {
    const { toBeCreated, toBeAdded } = await getMigrations(auth.options);
    console.log(`Auth schema: ${AUTH_SCHEMA}`);
    console.log(`Tables that would be created: ${toBeCreated.map((t) => t.table).join(", ") || "(none)"}`);
    console.log(
      `Columns that would be added: ${
        toBeAdded.map((t) => `${t.table}(${Object.keys(t.fields).join(", ")})`).join("; ") || "(none)"
      }`,
    );
    if (toBeCreated.length || toBeAdded.length) {
      console.error("\nMismatch: the eval app's Better Auth config doesn't match DocuMind's tables.");
      process.exitCode = 1;
    } else {
      console.log("\nNothing to migrate: the eval app matches DocuMind's auth tables.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
