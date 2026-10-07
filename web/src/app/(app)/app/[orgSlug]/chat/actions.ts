"use server";

import { z } from "zod";
import { ApiError, apiJson } from "@/lib/api";
import type { Conversation } from "@/lib/api-types";
import { requireOrgAccess } from "@/lib/auth-guards";

export type ChatActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const slugSchema = z.string().min(1).max(64);
const uuidSchema = z.uuid();

/** Org access is re-checked on every call; FastAPI enforces conversation ownership. */
async function actor(orgSlug: unknown) {
  const { user } = await requireOrgAccess(slugSchema.parse(orgSlug));
  return user.id;
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof ApiError && error.status === 404) return { ok: false, error: "That conversation no longer exists." };
  if (error instanceof ApiError && error.status < 500) return { ok: false, error: error.message };
  console.error("[chat] action failed:", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

export async function renameConversation(
  orgSlug: string,
  conversationId: string,
  title: string,
): Promise<ChatActionResult<Conversation>> {
  const userId = await actor(orgSlug);
  const parsed = z.object({ id: uuidSchema, title: z.string().trim().min(1).max(200) }).safeParse({ id: conversationId, title });
  if (!parsed.success) return { ok: false, error: "Give the conversation a title of up to 200 characters." };
  try {
    const data = await apiJson<Conversation>(`conversations/${parsed.data.id}`, {
      userId,
      method: "PATCH",
      body: { title: parsed.data.title },
    });
    return { ok: true, data };
  } catch (error) {
    return failure(error, "Couldn't rename the conversation. Try again.");
  }
}

export async function deleteConversation(orgSlug: string, conversationId: string): Promise<ChatActionResult> {
  const userId = await actor(orgSlug);
  const id = uuidSchema.safeParse(conversationId);
  if (!id.success) return { ok: false, error: "That conversation no longer exists." };
  try {
    await apiJson(`conversations/${id.data}`, { userId, method: "DELETE" });
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "Couldn't delete the conversation. Try again.");
  }
}

export async function submitFeedback(
  orgSlug: string,
  messageId: string,
  value: 1 | -1,
  comment: string | null,
): Promise<ChatActionResult> {
  const userId = await actor(orgSlug);
  const parsed = z
    .object({ id: uuidSchema, value: z.union([z.literal(1), z.literal(-1)]), comment: z.string().trim().max(2000).nullable() })
    .safeParse({ id: messageId, value, comment });
  if (!parsed.success) return { ok: false, error: "Feedback comments are limited to 2,000 characters." };
  try {
    await apiJson(`messages/${parsed.data.id}/feedback`, {
      userId,
      method: "POST",
      body: { value: parsed.data.value, comment: parsed.data.comment || null },
    });
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "Couldn't save your feedback. Try again.");
  }
}
