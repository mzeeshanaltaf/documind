/**
 * DATABASE_URL carries Prisma-style params (`schema`, `connection_limit`,
 * `pool_timeout`) that node-postgres doesn't understand. Read `schema`, strip
 * the rest, and keep the params pg does support (`sslmode`, `uselibpqcompat`).
 * Kept free of `server-only` so scripts run via tsx can import it.
 */
export function parseDatabaseUrl(raw: string | undefined) {
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const url = new URL(raw);
  const schema = url.searchParams.get("schema") || "documind";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema name in DATABASE_URL: ${schema}`);
  }
  for (const param of ["schema", "connection_limit", "pool_timeout"]) {
    url.searchParams.delete(param);
  }
  return { connectionString: url.toString(), schema };
}
