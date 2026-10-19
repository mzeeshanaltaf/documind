import "server-only";
import { Pool } from "pg";
import { authSchema, parseDatabaseUrl } from "./db-url";

// Don't throw at import time: `next build` imports this module to collect route config, and a
// build environment legitimately lacks DATABASE_URL.
const parsed = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL) : null;
if (!parsed) console.warn("[db] DATABASE_URL is not set; sign-in will fail.");

/** DocuMind's Better Auth schema. The eval web reads and writes only its auth tables. */
export const AUTH_SCHEMA = authSchema(parsed?.schema);

const globalForDb = globalThis as unknown as { evalAuthPool?: Pool };

/**
 * The shared Postgres serves every app on the VPS, and this pool only backs sign-in and session
 * reads, so it stays tiny. `search_path` pins DocuMind's auth schema (all eval data goes through
 * the eval API, never this pool).
 */
export const pool =
  globalForDb.evalAuthPool ??
  new Pool({
    connectionString: parsed?.connectionString,
    max: 3,
    options: `-c search_path=${AUTH_SCHEMA}`,
  });

if (process.env.NODE_ENV !== "production") globalForDb.evalAuthPool = pool;
