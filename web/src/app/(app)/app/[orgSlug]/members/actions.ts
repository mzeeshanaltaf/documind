"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOrgBySlug, requireAdmin } from "@/lib/auth-guards";
import * as members from "@/lib/org-members";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const slugSchema = z.string().min(1).max(64);
const idSchema = z.string().min(1).max(128);

/** Every action re-authorizes: platform admin + an existing org. */
async function authorize(orgSlug: unknown) {
  const { user } = await requireAdmin();
  const slug = slugSchema.safeParse(orgSlug);
  const org = slug.success ? await getOrgBySlug(slug.data) : null;
  return { user, org };
}

export async function addMemberByEmail(orgSlug: string, email: string): Promise<ActionResult> {
  const { user, org } = await authorize(orgSlug);
  if (!org) return { ok: false, error: "This organization no longer exists." };

  const parsed = z.email().safeParse(email.trim());
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };
  const address = parsed.data.toLowerCase();

  try {
    const existing = await members.findUserByEmail(address);
    if (existing) {
      if (await members.isMember(org.id, existing.id)) {
        return { ok: false, error: `${existing.email} is already a member of ${org.name}.` };
      }
      await auth.api.addMember({ body: { userId: existing.id, organizationId: org.id, role: "member" } });
      // A stale invitation for the same address would otherwise linger as "pending".
      const pending = await members.findPendingInvitation(org.id, address);
      if (pending) await members.cancelInvitation(pending.id, org.id);
      refresh();
      return { ok: true, message: `${existing.name || existing.email} now has access to ${org.name}.` };
    }

    if (await members.findPendingInvitation(org.id, address)) {
      return { ok: false, error: `${address} already has a pending invitation. Resend it from the list below.` };
    }
    const { emailSent } = await members.createInvitation({ organization: org, email: address, inviter: user });
    refresh();
    return emailSent
      ? { ok: true, message: `Invitation sent to ${address}.` }
      : { ok: false, error: `The invitation was created, but the email to ${address} didn't send. Use Resend below.` };
  } catch (err) {
    console.error("[members] addMemberByEmail failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Something went wrong adding that person. Try again in a moment." };
  }
}

export async function removeMember(orgSlug: string, memberId: string): Promise<ActionResult> {
  const { org } = await authorize(orgSlug);
  if (!org) return { ok: false, error: "This organization no longer exists." };
  if (!idSchema.safeParse(memberId).success) return { ok: false, error: "Unknown member." };
  const removed = await members.removeMember(memberId, org.id);
  refresh();
  return removed ? { ok: true, message: "Member removed." } : { ok: false, error: "That member was already removed." };
}

export async function resendInvitation(orgSlug: string, invitationId: string): Promise<ActionResult> {
  const { user, org } = await authorize(orgSlug);
  if (!org) return { ok: false, error: "This organization no longer exists." };
  if (!idSchema.safeParse(invitationId).success) return { ok: false, error: "Unknown invitation." };
  try {
    const invitation = await members.resendInvitation({ invitationId, organization: org, inviter: user });
    refresh();
    return invitation
      ? { ok: true, message: `Invitation resent to ${invitation.email}. It's valid for another 48 hours.` }
      : { ok: false, error: "That invitation is no longer pending." };
  } catch (err) {
    console.error("[members] resendInvitation failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "We couldn't resend the invitation. Try again in a moment." };
  }
}

export async function cancelInvitation(orgSlug: string, invitationId: string): Promise<ActionResult> {
  const { org } = await authorize(orgSlug);
  if (!org) return { ok: false, error: "This organization no longer exists." };
  if (!idSchema.safeParse(invitationId).success) return { ok: false, error: "Unknown invitation." };
  const canceled = await members.cancelInvitation(invitationId, org.id);
  refresh();
  return canceled
    ? { ok: true, message: "Invitation withdrawn." }
    : { ok: false, error: "That invitation is no longer pending." };
}
