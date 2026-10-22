import "server-only";
import type { QueryResultRow } from "pg";
import { pool } from "./db";
import { officeSchema } from "./db-url";

/**
 * Queries on the office's own tables. SQL names them `{office}.players` etc. (as the migrations
 * do) and `{office}` becomes OFFICE_DB_SCHEMA, validated against `^[a-z_][a-z0-9_]*$`, so a
 * schema name is never hard-coded or interpolated unchecked. Resolved on first use, not at
 * import: `next build` imports this without the env.
 */
let schema: string | undefined;

export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  schema ??= officeSchema();
  const { rows } = await pool.query<T>(sql.replaceAll("{office}", schema), params);
  return rows;
}
