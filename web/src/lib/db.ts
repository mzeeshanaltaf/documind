import "server-only";
import { Pool } from "pg";
import { parseDatabaseUrl } from "./db-url";

// Don't throw at import time: `next build` imports this module to collect route
// config, and a build environment may legitimately lack DATABASE_URL.
const parsed = process.env.DATABASE_URL ? parseDatabaseUrl(process.env.DATABASE_URL) : null;
if (!parsed) console.warn("[db] DATABASE_URL is not set; database queries will fail.");

/** Postgres schema holding every DocuMind table (Better Auth's and the API's). */
export const DB_SCHEMA = parsed?.schema ?? "documind";

const globalForDb = globalThis as unknown as { documindPool?: Pool };

/**
 * Shared pg Pool. The VPS database is shared between apps, so keep it small.
 * `search_path` is pinned per connection: our schema first, then `public`
 * (where the `vector` extension lives).
 */
export const pool =
  globalForDb.documindPool ??
  new Pool({
    connectionString: parsed?.connectionString,
    max: 5,
    options: `-c search_path=${DB_SCHEMA},public`,
  });

if (process.env.NODE_ENV !== "production") globalForDb.documindPool = pool;
