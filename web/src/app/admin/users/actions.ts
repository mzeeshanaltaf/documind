"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { ApiError, apiJson } from "@/lib/api";
import { auth, platformAdminEmails } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-guards";
import { pool } from "@/lib/db";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const userIdSchema = z.string().min(1).max(128);

async function loadTarget(userId: unknown) {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return null;
  const { rows } = await pool.query<{ id: string; email: string; name: string }>(
    `select id, email, name from "user" where id = $1`,
    [parsed.data],
  );
  return rows[0] ?? null;
}

function failure(err: unknown, fallback: string): ActionResult {
  console.error("[admin/users]", err instanceof Error ? err.message : err);
  return { ok: false, error: fallback };
}

export async function setPlatformAdmin(userId: string, makeAdmin: boolean): Promise<ActionResult> {
  const { user: actor } = await requireAdmin();
  const target = await loadTarget(userId);
  if (!target) return { ok: false, error: "That user no longer exists." };
  if (target.id === actor.id) return { ok: false, error: "You can't change your own role." };
  if (!makeAdmin && platformAdminEmails().includes(target.email.toLowerCase())) {
    return {
      ok: false,
      error: `${target.email} is listed in PLATFORM_ADMIN_EMAILS and would be re-promoted at next sign-in. Remove it there first.`,
    };
  }
  try {
    await auth.api.setRole({ headers: await headers(), body: { userId: target.id, role: makeAdmin ? "admin" : "user" } });
    refresh();
    return {
      ok: true,
      message: makeAdmin
        ? `${target.name || target.email} is now a platform admin.`
        : `${target.name || target.email} is no longer a platform admin.`,
    };
  } catch (err) {
    return failure(err, "We couldn't change that role. Try again in a moment.");
  }
}

const QUOTA_MAX_MESSAGES = 1_000_000;
const QUOTA_MAX_TOKENS = 10_000_000_000;
const quotaSchema = z.object({
  userId: userIdSchema,
  messageLimit: z.number().int().min(0).max(QUOTA_MAX_MESSAGES),
  tokenLimit: z.number().int().min(0).max(QUOTA_MAX_TOKENS),
});

function quotaFailure(err: unknown, fallback: string): ActionResult {
  if (err instanceof ApiError && err.status < 500) return { ok: false, error: err.message };
  return failure(err, fallback);
}

/** Raise or lower one user's monthly message and token limits (takes effect immediately). */
export async function updateUserQuota(userId: string, messageLimit: number, tokenLimit: number): Promise<ActionResult> {
  const { user: actor } = await requireAdmin();
  const parsed = quotaSchema.safeParse({ userId, messageLimit, tokenLimit });
  if (!parsed.success) {
    return {
      ok: false,
      error: `Use whole numbers: up to ${QUOTA_MAX_MESSAGES.toLocaleString("en-US")} messages and ${QUOTA_MAX_TOKENS.toLocaleString("en-US")} tokens.`,
    };
  }
  try {
    await apiJson(`admin/users/${encodeURIComponent(parsed.data.userId)}/quota`, {
      userId: actor.id,
      method: "PUT",
      body: { message_limit: parsed.data.messageLimit, token_limit: parsed.data.tokenLimit },
    });
    refresh();
    return { ok: true, message: "Quota updated. It applies to their next message." };
  } catch (err) {
    return quotaFailure(err, "We couldn't update that quota. Try again in a moment.");
  }
}

/** Back to the default allowance. */
export async function resetUserQuota(userId: string): Promise<ActionResult> {
  const { user: actor } = await requireAdmin();
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return { ok: false, error: "That user no longer exists." };
  try {
    await apiJson(`admin/users/${encodeURIComponent(parsed.data)}/quota`, { userId: actor.id, method: "DELETE" });
    refresh();
    return { ok: true, message: "Quota reset to the default." };
  } catch (err) {
    return quotaFailure(err, "We couldn't reset that quota. Try again in a moment.");
  }
}

export async function setBanned(userId: string, ban: boolean): Promise<ActionResult> {
  const { user: actor } = await requireAdmin();
  const target = await loadTarget(userId);
  if (!target) return { ok: false, error: "That user no longer exists." };
  if (target.id === actor.id) return { ok: false, error: "You can't suspend your own account." };
  try {
    const h = await headers();
    if (ban) {
      // banUser also revokes the user's sessions.
      await auth.api.banUser({ headers: h, body: { userId: target.id, banReason: "Suspended by a platform admin" } });
    } else {
      await auth.api.unbanUser({ headers: h, body: { userId: target.id } });
    }
    refresh();
    return {
      ok: true,
      message: ban
        ? `${target.name || target.email} is suspended and signed out everywhere.`
        : `${target.name || target.email} can sign in again.`,
    };
  } catch (err) {
    return failure(err, ban ? "We couldn't suspend that account." : "We couldn't restore that account.");
  }
}
