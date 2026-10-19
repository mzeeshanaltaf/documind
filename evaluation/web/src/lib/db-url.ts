/**
 * DATABASE_URL carries Prisma-style params (`schema`, `connection_limit`, `pool_timeout`) that
 * node-postgres doesn't understand. Read `schema`, strip the rest, and keep the params pg does
 * support (`sslmode`, `uselibpqcompat`). Copied from web/src/lib/db-url.ts.
 * Kept free of `server-only` so scripts run via tsx can import it.
 */
const SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/;

export function parseDatabaseUrl(raw: string | undefined) {
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema") || "documind";
  if (!SCHEMA_NAME.test(schema)) {
    throw new Error(`Invalid schema name in DATABASE_URL: ${schema}`);
  }
  for (const param of ["schema", "connection_limit", "pool_timeout"]) {
    url.searchParams.delete(param);
  }
  return { connectionString: url.toString(), schema };
}

/** DocuMind's Better Auth schema: EVAL_AUTH_SCHEMA, else the URL's own `schema`. */
export function authSchema(fromUrl: string | undefined): string {
  const schema = process.env.EVAL_AUTH_SCHEMA || fromUrl || "documind";
  if (!SCHEMA_NAME.test(schema)) throw new Error(`Invalid EVAL_AUTH_SCHEMA: ${schema}`);
  return schema;
}
