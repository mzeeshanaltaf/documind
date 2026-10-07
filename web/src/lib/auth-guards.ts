import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth, type Session, type SessionUser } from "./auth";
import { pool } from "./db";

export type Org = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
};

export type OrgAccess = {
  user: SessionUser;
  session: Session["session"];
  org: Org;
  /** The user's org role ("owner" | "admin" | "member"), or null for a platform admin who isn't a member. */
  role: string | null;
  /** Platform admin (user.role === "admin"): full access to every org. */
  isAdmin: boolean;
};

export function isPlatformAdmin(user: Pick<SessionUser, "role"> | null | undefined) {
  return user?.role === "admin";
}

/** The current session, read once per request. Null when signed out. */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  // Reached with a cookie the proxy accepted but the server rejected (expired or revoked).
  if (!session) redirect("/sign-in?reauth=1");
  return session;
}

/** Platform admin only. Everyone else gets a 404, so admin routes aren't advertised. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!isPlatformAdmin(session.user)) notFound();
  return session;
}

export const getOrgBySlug = cache(async (slug: string): Promise<Org | null> => {
  const { rows } = await pool.query<Org>(
    `select id, name, slug, logo, "createdAt" from organization where slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
});

async function getMemberRole(userId: string, organizationId: string): Promise<string | null> {
  const { rows } = await pool.query<{ role: string }>(
    `select role from member where "userId" = $1 and "organizationId" = $2`,
    [userId, organizationId],
  );
  return rows[0]?.role ?? null;
}

/**
 * Access to one org: platform admin OR a member row. A missing org and a
 * forbidden org both 404, so slugs can't be probed.
 */
export const requireOrgAccess = cache(async (orgSlug: string): Promise<OrgAccess> => {
  const { user, session } = await requireSession();
  const org = await getOrgBySlug(orgSlug);
  if (!org) notFound();
  const isAdmin = isPlatformAdmin(user);
  const role = await getMemberRole(user.id, org.id);
  if (!isAdmin && !role) notFound();
  return { user, session, org, role, isAdmin };
});

/** Org-scoped admin pages (members, documents, settings, analytics). */
export async function requireOrgAdmin(orgSlug: string): Promise<OrgAccess> {
  const access = await requireOrgAccess(orgSlug);
  if (!access.isAdmin) notFound();
  return access;
}

/** Admins see every org; members see the orgs they belong to. */
export async function listAccessibleOrgs(user: SessionUser): Promise<Org[]> {
  if (isPlatformAdmin(user)) {
    const { rows } = await pool.query<Org>(
      `select id, name, slug, logo, "createdAt" from organization order by name`,
    );
    return rows;
  }
  const orgs = await auth.api.listOrganizations({ headers: await headers() });
  return orgs
    .map((o) => ({ id: o.id, name: o.name, slug: o.slug, logo: o.logo ?? null, createdAt: o.createdAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
