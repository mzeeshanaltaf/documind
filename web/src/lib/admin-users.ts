import "server-only";
import { pool } from "./db";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string | null;
  banned: boolean | null;
  emailVerified: boolean;
  createdAt: Date;
  orgCount: number;
};

export const USERS_PAGE_SIZE = 50;

/** Case-insensitive search across name and email, newest first. */
export async function searchUsers(query: string, offset = 0) {
  const q = query.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await pool.query<AdminUserRow & { total: string }>(
    `select u.id, u.name, u.email, u.image, u.role, u.banned, u."emailVerified", u."createdAt",
            (select count(*)::int from member m where m."userId" = u.id) as "orgCount",
            count(*) over () as total
       from "user" u
      where $1::text is null or u.email ilike $1 or u.name ilike $1
      order by u."createdAt" desc
      limit $2 offset $3`,
    [pattern, USERS_PAGE_SIZE, offset],
  );
  return { users: rows, total: rows.length ? Number(rows[0].total) : 0 };
}
