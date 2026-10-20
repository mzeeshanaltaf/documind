"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/auth-guards";
import { pool } from "@/lib/db";
import { IS_EVAL_ORG_SQL, isMember } from "@/lib/org-members";

export type JoinResult = { ok: true; slug: string; name: string } | { ok: false; error: string };

/** Self-service join: any signed-in user can become a "member" of any organization, except the
 * evaluation harness's own orgs (they read as nonexistent). */
export async function joinOrganization(orgId: string): Promise<JoinResult> {
  const { user } = await requireSession();
  const id = z.string().min(1).max(128).safeParse(orgId);
  if (!id.success) return { ok: false, error: "Unknown organization." };

  try {
    const { rows } = await pool.query<{ id: string; name: string; slug: string }>(
      `select o.id, o.name, o.slug from organization o where o.id = $1 and not (${IS_EVAL_ORG_SQL})`,
      [id.data],
    );
    const org = rows[0];
    if (!org) return { ok: false, error: "This organization no longer exists." };
    if (await isMember(org.id, user.id)) return { ok: true, slug: org.slug, name: org.name };

    await auth.api.addMember({ body: { userId: user.id, organizationId: org.id, role: "member" } });
    // A pending invitation for this address is now moot.
    await pool.query(
      `update invitation set status = 'accepted'
        where "organizationId" = $1 and lower(email) = lower($2) and status = 'pending'`,
      [org.id, user.email],
    );
    refresh();
    return { ok: true, slug: org.slug, name: org.name };
  } catch (err) {
    console.error("[join] joinOrganization failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "We couldn't add you to that organization. Try again in a moment." };
  }
}
