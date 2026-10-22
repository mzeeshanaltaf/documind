import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { authSchema, parseDatabaseUrl } from "../../src/lib/db-url";

/**
 * A throwaway signed-in user for browser tests: a verified `test-office-e2e-*` row in DocuMind's
 * auth tables plus a session, and the session cookie signed with the office's secret exactly as
 * Better Auth signs it (`token.base64(HMAC-SHA256)`, URI-encoded). `remove()` deletes the user;
 * the session and every office row cascade with it.
 */
const rootEnv = path.resolve(__dirname, "..", "..", "..", ".env.local");
if (fs.existsSync(rootEnv)) {
  for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(rootEnv, "utf8")))) {
    process.env[key] ??= value;
  }
}

export const SESSION_COOKIE = "documind-office.session_token";

export type TestUser = { id: string; email: string; cookie: string; remove: () => Promise<void> };

export async function createTestUser(name = "Test Office E2E"): Promise<TestUser> {
  const secret = process.env.OFFICE_BETTER_AUTH_SECRET;
  if (!secret) throw new Error("OFFICE_BETTER_AUTH_SECRET is not set (root .env.local).");
  const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
  const schema = authSchema(parsed.schema);
  const pool = new Pool({ connectionString: parsed.connectionString, max: 1, options: `-c search_path=${schema}` });

  const suffix = crypto.randomBytes(6).toString("hex");
  const id = `test-office-e2e-${suffix}`;
  const email = `${id}@example.test`;
  const token = crypto.randomBytes(24).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);

  await pool.query(
    `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, $4, $4)`,
    [id, name, email, now],
  );
  await pool.query(
    `insert into session (id, token, "userId", "expiresAt", "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, $5)`,
    [`${id}-session`, token, id, expires, now],
  );

  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return {
    id,
    email,
    cookie: encodeURIComponent(`${token}.${signature}`),
    async remove() {
      try {
        await pool.query(`delete from "user" where id = $1`, [id]);
      } finally {
        await pool.end();
      }
    },
  };
}
