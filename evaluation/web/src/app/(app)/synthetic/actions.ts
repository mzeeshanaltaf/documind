"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  type Candidate,
  type CommitResult,
  EXPECTED_BEHAVIORS,
  GENERATOR_MODELS,
  SYNTHETIC_TYPES,
  type SyntheticBatch,
} from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { type ActionResult, action, apiJson } from "@/lib/eval-api";

const id = z.uuid();
const count = z.number().int().min(0).max(100);

// Mirrors the eval API's BatchIn; the API validates again (org, documents, totals).
const batchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("synthetic"),
    name: z.string().trim().max(200).nullish(),
    org_slug: z.string().trim().min(1).max(100),
    target_dataset_id: id.nullish(),
    document_ids: z.array(z.string().min(1)).max(200),
    type_counts: z.partialRecord(z.enum(SYNTHETIC_TYPES), count),
    generator_model: z.enum(GENERATOR_MODELS),
    seed: z.number().int().min(0).max(2 ** 31 - 1).nullish(),
    max_cost_usd: z.number().positive().max(100).nullish(),
  }),
  z.object({
    kind: z.literal("enrichment"),
    name: z.string().trim().max(200).nullish(),
    dataset_version_id: id,
    generator_model: z.enum(GENERATOR_MODELS),
    only_missing: z.boolean(),
    max_cost_usd: z.number().positive().max(100).nullish(),
  }),
]);

export async function createBatch(input: z.input<typeof batchSchema>): Promise<ActionResult<SyntheticBatch>> {
  const { user } = await requireAdmin();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const body = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== null && v !== undefined));
  return action(() => apiJson<SyntheticBatch>("synthetic-batches", { userId: user.id, method: "POST", body }));
}

export async function resumeBatch(batchId: string, maxCostUsd?: number | null): Promise<ActionResult<SyntheticBatch>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(batchId).success) return { ok: false, error: "Unknown batch." };
  const cap = z.number().positive().max(100).nullish().safeParse(maxCostUsd);
  if (!cap.success) return { ok: false, error: "Enter a cap in dollars (up to $100)." };
  const result = await action(() =>
    apiJson<SyntheticBatch>(`synthetic-batches/${batchId}/resume`, {
      userId: user.id,
      method: "POST",
      body: cap.data != null ? { max_cost_usd: cap.data } : {},
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function deleteBatch(batchId: string): Promise<ActionResult<undefined>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(batchId).success) return { ok: false, error: "Unknown batch." };
  return action(() => apiJson<undefined>(`synthetic-batches/${batchId}`, { userId: user.id, method: "DELETE" }));
}

export async function commitBatch(batchId: string, datasetId: string | null): Promise<ActionResult<CommitResult>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(batchId).success) return { ok: false, error: "Unknown batch." };
  if (datasetId && !id.safeParse(datasetId).success) return { ok: false, error: "Unknown dataset." };
  return action(() =>
    apiJson<CommitResult>(`synthetic-batches/${batchId}/commit`, {
      userId: user.id,
      method: "POST",
      body: datasetId ? { dataset_id: datasetId } : {},
    }),
  );
}

// --- candidates ------------------------------------------------------------------------------------

const keyFact = z.object({ fact: z.string().trim().min(1).max(2000), weight: z.number().positive().max(10) });
const codes = z.array(z.string().trim().min(1).max(100)).max(20);
const patchSchema = z
  .object({
    question: z.string().trim().min(1, "The question can't be empty.").max(4000),
    reference_answer: z.string().trim().max(8000).nullable(),
    key_facts: z.array(keyFact).max(20),
    expected_doc_codes: codes,
    expected_sections: codes,
    expected_jurisdiction: z.string().trim().max(10).nullable(),
    expected_behavior: z.enum(EXPECTED_BEHAVIORS),
  })
  .partial();

export async function updateCandidate(
  candidateId: string,
  input: z.input<typeof patchSchema>,
): Promise<ActionResult<Candidate>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(candidateId).success) return { ok: false, error: "Unknown candidate." };
  const parsed = patchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the fields." };
  return action(() =>
    apiJson<Candidate>(`candidates/${candidateId}`, { userId: user.id, method: "PATCH", body: parsed.data }),
  );
}

async function review(candidateId: string, verb: "approve" | "reject" | "restore", body?: unknown) {
  const { user } = await requireAdmin();
  if (!id.safeParse(candidateId).success) return { ok: false as const, error: "Unknown candidate." };
  return action(() => apiJson<Candidate>(`candidates/${candidateId}/${verb}`, { userId: user.id, method: "POST", body }));
}

export async function approveCandidate(candidateId: string): Promise<ActionResult<Candidate>> {
  return review(candidateId, "approve");
}

export async function rejectCandidate(candidateId: string, reason?: string | null): Promise<ActionResult<Candidate>> {
  const parsed = z.string().trim().max(500).nullish().safeParse(reason);
  if (!parsed.success) return { ok: false, error: "Keep the reason under 500 characters." };
  return review(candidateId, "reject", parsed.data ? { reason: parsed.data } : {});
}

export async function restoreCandidate(candidateId: string): Promise<ActionResult<Candidate>> {
  return review(candidateId, "restore");
}
