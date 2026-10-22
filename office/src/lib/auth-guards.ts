import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { BANNED_CODE, hasAdminRole, isBanned } from "./account";
import { auth, type Session, type SessionUser } from "./auth";
import { pool } from "./db";
import { isEvalOrgMetadata } from "./org-meta";

/** The current session, read once per request. Null when signed out. */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * Every layout, page and Server Action calls this. Sign-in already refuses banned users; this
 * catches a ban applied in DocuMind after signing in here (the session read is uncached, so
 * `banned` is current).
 */
export const requireSession = cache(async (): Promise<Session> => {
  const session = await getSession();
  // A cookie the proxy accepted but the server rejected (expired or revoked).
  if (!session) redirect("/sign-in?reauth=1");
  if (isBanned(session.user.banned, session.user.banExpires)) redirect(`/sign-in?reauth=1&error=${BANNED_CODE}`);
  return session;
});

export type OrgAccess = {
  user: SessionUser;
  org: { id: string; name: string; slug: string };
  /** `member.role`; null when a platform admin isn't a member. */
  role: string | null;
  isAdmin: boolean;
};

/**
 * Org-scoped pages and Server Actions call this: a platform admin, or a `member` row. Anything
 * else (no such org, an eval org, not a member) is `notFound()`, so org ids don't leak.
 */
export const requireOrgAccess = cache(async (orgId: string): Promise<OrgAccess> => {
  const session = await requireSession();
  const isAdmin = hasAdminRole(session.user.role);
  const { rows } = await pool.query<{ id: string; name: string; slug: string; metadata: string | null; role: string | null }>(
    `select o.id, o.name, o.slug, o.metadata, m.role
       from organization o
       left join member m on m."organizationId" = o.id and m."userId" = $2
      where o.id = $1
      limit 1`,
    [orgId, session.user.id],
  );
  const row = rows[0];
  if (!row || isEvalOrgMetadata(row.metadata) || (!isAdmin && !row.role)) notFound();
  return { user: session.user, org: { id: row.id, name: row.name, slug: row.slug }, role: row.role, isAdmin };
});

/** Drops eval orgs from a list DocuMind returned (`/v1/me` lists every org to platform admins). */
export async function withoutEvalOrgs<T extends { id: string }>(orgs: T[]): Promise<T[]> {
  if (orgs.length === 0) return orgs;
  const { rows } = await pool.query<{ id: string; metadata: string | null }>(
    `select id, metadata from organization where id = any($1::text[])`,
    [orgs.map((org) => org.id)],
  );
  const hidden = new Set(rows.filter((row) => isEvalOrgMetadata(row.metadata)).map((row) => row.id));
  return orgs.filter((org) => !hidden.has(org.id));
}
