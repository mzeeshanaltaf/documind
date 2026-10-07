import "server-only";
import { auth } from "./auth";
import { pool } from "./db";
import { sendInvitationEmail } from "./email/invitation-email";

/** Matches Better Auth's default (organization.invitationExpiresIn = 48h). */
export const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

export type MemberRow = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  name: string;
  email: string;
  image: string | null;
  userRole: string | null;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterName: string | null;
  /** Whole hours until expiry (computed in SQL); <= 0 means expired. */
  hoursLeft: number;
};

export async function listMembers(organizationId: string): Promise<MemberRow[]> {
  const { rows } = await pool.query<MemberRow>(
    `select m.id, m."userId", m.role, m."createdAt", u.name, u.email, u.image, u.role as "userRole"
       from member m join "user" u on u.id = m."userId"
      where m."organizationId" = $1
      order by m."createdAt" asc`,
    [organizationId],
  );
  return rows;
}

export async function listPendingInvitations(organizationId: string): Promise<InvitationRow[]> {
  const { rows } = await pool.query<InvitationRow>(
    `select i.id, i.email, i.role, i.status, i."expiresAt", i."createdAt", u.name as "inviterName",
            floor(extract(epoch from (i."expiresAt" - now())) / 3600)::int as "hoursLeft"
       from invitation i left join "user" u on u.id = i."inviterId"
      where i."organizationId" = $1 and i.status = 'pending'
      order by i."createdAt" desc`,
    [organizationId],
  );
  return rows;
}

export async function findUserByEmail(email: string) {
  const { rows } = await pool.query<{ id: string; email: string; name: string }>(
    `select id, email, name from "user" where lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

export async function isMember(organizationId: string, userId: string) {
  const { rowCount } = await pool.query(`select 1 from member where "organizationId" = $1 and "userId" = $2`, [
    organizationId,
    userId,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function findPendingInvitation(organizationId: string, email: string) {
  const { rows } = await pool.query<{ id: string }>(
    `select id from invitation where "organizationId" = $1 and lower(email) = lower($2) and status = 'pending'`,
    [organizationId, email],
  );
  return rows[0] ?? null;
}

/**
 * Creates a pending invitation through Better Auth's own adapter (same ids and
 * columns as its endpoints) and emails it. Better Auth's createInvitation
 * endpoint requires the inviter to be an org member with invite rights, which
 * a platform admin managing someone else's org may not be; authorization is
 * done by the caller (requireAdmin) instead.
 */
export async function createInvitation({
  organization,
  email,
  inviter,
}: {
  organization: { id: string; name: string };
  email: string;
  inviter: { id: string; name: string; email: string };
}) {
  const ctx = await auth.$context;
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const invitation = await ctx.adapter.create<{ id: string }>({
    model: "invitation",
    data: {
      organizationId: organization.id,
      email: email.toLowerCase(),
      role: "member",
      status: "pending",
      expiresAt,
      createdAt: new Date(),
      inviterId: inviter.id,
    },
  });
  try {
    await sendInvitationEmail({
      invitationId: invitation.id,
      email: email.toLowerCase(),
      organizationName: organization.name,
      inviterName: inviter.name,
      inviterEmail: inviter.email,
      expiresAt,
    });
    return { invitation, emailSent: true };
  } catch {
    // Already logged by sendEmail. The invitation stands; the admin can resend it.
    return { invitation, emailSent: false };
  }
}

/** Extends a pending invitation by another 48h and sends the email again. */
export async function resendInvitation({
  invitationId,
  organization,
  inviter,
}: {
  invitationId: string;
  organization: { id: string; name: string };
  inviter: { name: string; email: string };
}) {
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const { rows } = await pool.query<{ id: string; email: string }>(
    `update invitation set "expiresAt" = $1
      where id = $2 and "organizationId" = $3 and status = 'pending'
      returning id, email`,
    [expiresAt, invitationId, organization.id],
  );
  const invitation = rows[0];
  if (!invitation) return null;
  await sendInvitationEmail({
    invitationId: invitation.id,
    email: invitation.email,
    organizationName: organization.name,
    inviterName: inviter.name,
    inviterEmail: inviter.email,
    expiresAt,
  });
  return invitation;
}

export async function cancelInvitation(invitationId: string, organizationId: string) {
  const { rowCount } = await pool.query(
    `update invitation set status = 'canceled' where id = $1 and "organizationId" = $2 and status = 'pending'`,
    [invitationId, organizationId],
  );
  return (rowCount ?? 0) > 0;
}

export async function removeMember(memberId: string, organizationId: string) {
  const { rowCount } = await pool.query(`delete from member where id = $1 and "organizationId" = $2`, [
    memberId,
    organizationId,
  ]);
  return (rowCount ?? 0) > 0;
}
