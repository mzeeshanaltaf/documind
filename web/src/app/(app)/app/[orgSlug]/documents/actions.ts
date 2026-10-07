"use server";

import { z } from "zod";
import { ApiError, apiJson } from "@/lib/api";
import type { DocumentDetail, IngestionJob } from "@/lib/api-types";
import { requireOrgAdmin } from "@/lib/auth-guards";
import { type MetadataInput, metadataSchema } from "@/lib/document-metadata";

export type DocActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function authorize(orgSlug: unknown) {
  const { user, org } = await requireOrgAdmin(z.string().min(1).max(64).parse(orgSlug));
  return { userId: user.id, orgId: org.id };
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof ApiError && error.status === 404) return { ok: false, error: "That document no longer exists." };
  if (error instanceof ApiError && error.status < 500) return { ok: false, error: error.message };
  console.error("[documents] action failed:", error instanceof Error ? error.message : error);
  return { ok: false, error: fallback };
}

export async function updateDocument(
  orgSlug: string,
  documentId: string,
  input: MetadataInput,
): Promise<DocActionResult<DocumentDetail & { needs_reindex: boolean }>> {
  const { userId, orgId } = await authorize(orgSlug);
  const id = z.uuid().safeParse(documentId);
  const parsed = metadataSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "That document no longer exists." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the highlighted fields." };
  try {
    const data = await apiJson<DocumentDetail & { needs_reindex: boolean }>(`orgs/${orgId}/documents/${id.data}`, {
      userId,
      method: "PATCH",
      body: parsed.data,
    });
    return { ok: true, data };
  } catch (error) {
    return failure(error, "Couldn't save the changes. Try again.");
  }
}

export async function reindexDocument(orgSlug: string, documentId: string): Promise<DocActionResult<IngestionJob>> {
  const { userId, orgId } = await authorize(orgSlug);
  const id = z.uuid().safeParse(documentId);
  if (!id.success) return { ok: false, error: "That document no longer exists." };
  try {
    const data = await apiJson<IngestionJob>(`orgs/${orgId}/documents/${id.data}/reindex`, { userId, method: "POST" });
    return { ok: true, data };
  } catch (error) {
    return failure(error, "Couldn't start the reindex. Try again.");
  }
}

export async function deleteDocument(orgSlug: string, documentId: string): Promise<DocActionResult> {
  const { userId, orgId } = await authorize(orgSlug);
  const id = z.uuid().safeParse(documentId);
  if (!id.success) return { ok: false, error: "That document no longer exists." };
  try {
    await apiJson(`orgs/${orgId}/documents/${id.data}`, { userId, method: "DELETE" });
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "Couldn't delete the document. Try again.");
  }
}
