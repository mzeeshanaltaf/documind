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
  org: { id: string; name: string; slug: string; logo: string | null };
  /** `member.role`; null when a platform admin isn't a member. */
  role: string | null;
  isAdmin: boolean;
};

async function orgAccess(column: "id" | "slug", value: string): Promise<OrgAccess> {
  const session = await requireSession();
  const isAdmin = hasAdminRole(session.user.role);
  const { rows } = await pool.query<{
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    metadata: string | null;
    role: string | null;
  }>(
    `select o.id, o.name, o.slug, o.logo, o.metadata, m.role
       from organization o
       left join member m on m."organizationId" = o.id and m."userId" = $2
      where o.${column} = $1
      limit 1`,
    [value, session.user.id],
  );
  const row = rows[0];
  if (!row || isEvalOrgMetadata(row.metadata) || (!isAdmin && !row.role)) notFound();
  const org = { id: row.id, name: row.name, slug: row.slug, logo: row.logo || null };
  return { user: session.user, org, role: row.role, isAdmin };
}

/**
 * Org-scoped pages and Server Actions call this: a platform admin, or a `member` row. Anything
 * else (no such org, an eval org, not a member) is `notFound()`, so org ids don't leak.
 */
export const requireOrgAccess = cache((orgId: string) => orgAccess("id", orgId));

/** The same check for the org pages, which have the slug from the URL (`/[orgSlug]`). */
export const requireOrgAccessBySlug = cache((slug: string) => orgAccess("slug", slug));

/**
 * Drops eval orgs from a list DocuMind returned (`/v1/me` lists every org to platform admins,
 * and carries no metadata), and adds each org's logo URL (null when it has none).
 */
export async function withoutEvalOrgs<T extends { id: string }>(orgs: T[]): Promise<(T & { logo: string | null })[]> {
  if (orgs.length === 0) return [];
  const { rows } = await pool.query<{ id: string; metadata: string | null; logo: string | null }>(
    `select id, metadata, logo from organization where id = any($1::text[])`,
    [orgs.map((org) => org.id)],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return orgs.flatMap((org) => {
    const row = byId.get(org.id);
    return row && !isEvalOrgMetadata(row.metadata) ? [{ ...org, logo: row.logo || null }] : [];
  });
}
