import "server-only";
import { Pool } from "pg";
import { authSchema, parseDatabaseUrl } from "./db-url";

// Don't throw at import time: `next build` imports this module to collect route config, and a
// build environment legitimately lacks DATABASE_URL.
const parsed = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL) : null;
if (!parsed) console.warn("[db] DATABASE_URL is not set; sign-in will fail.");

/** DocuMind's Better Auth schema. The office reads it and writes only sessions (sign-in/out). */
export const AUTH_SCHEMA = authSchema(parsed?.schema);

const globalForDb = globalThis as unknown as { officePool?: Pool };

/**
 * The shared Postgres serves every app on the VPS, so the pool stays tiny. `search_path` pins
 * DocuMind's auth schema for Better Auth; office tables are always schema-qualified
 * (lib/office-db.ts), so the same pool serves both.
 */
export const pool =
  globalForDb.officePool ??
  new Pool({
    connectionString: parsed?.connectionString,
    max: 3,
    options: `-c search_path=${AUTH_SCHEMA}`,
  });

if (process.env.NODE_ENV !== "production") globalForDb.officePool = pool;
