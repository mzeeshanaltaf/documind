"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  CASE_SOURCES,
  CASE_TYPES,
  type CaseOut,
  DATASET_KINDS,
  type DatasetDetail,
  DIFFICULTIES,
  EXPECTED_BEHAVIORS,
  type VersionDetail,
} from "@/lib/api-types";
import { requireAdmin } from "@/lib/auth-guards";
import { type ActionResult, action, apiJson } from "@/lib/eval-api";
import { PINNED_DATASET_COOKIE } from "@/lib/pinned";

const id = z.uuid();
const list = z.array(z.string().trim().min(1)).default([]);
const nullableText = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null));

// Mirrors the eval API's CaseFields; the API validates again and its message is shown inline.
const caseSchema = z.object({
  case_key: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,80}$/, "Use 1–80 letters, digits, - or _.")
    .optional(),
  type: z.enum(CASE_TYPES),
  question: z.string().trim().min(1, "Enter the question.").max(4000),
  setup_turns: list,
  reference_answer: nullableText,
  key_facts: z.array(z.object({ fact: z.string().trim().min(1), weight: z.number().gt(0).max(10) })).default([]),
  expected_doc_codes: list,
  expected_sections: list,
  expected_pages: z.unknown().optional(),
  expected_departments: list,
  expected_jurisdiction: nullableText,
  expected_behavior: z.enum(EXPECTED_BEHAVIORS),
  scope_doc_codes: list,
  forbidden_doc_codes: list,
  injection_canary: nullableText,
  expected_standalone_query: nullableText,
  tags: list,
  difficulty: z.enum(DIFFICULTIES).nullable().default(null),
  source: z.enum(CASE_SOURCES),
  notes: nullableText,
});
export type CaseInput = z.input<typeof caseSchema>;

function invalid(error: z.ZodError): ActionResult<never> {
  const issue = error.issues[0];
  const field = issue?.path.join(".");
  return { ok: false, error: field ? `${field}: ${issue.message}` : (issue?.message ?? "Check the form.") };
}

const datasetSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Use lowercase letters, digits and hyphens."),
  name: z.string().trim().min(1, "Enter a name.").max(200),
  description: nullableText,
  default_org_slug: nullableText,
  kind: z.enum(DATASET_KINDS),
});

export async function createDataset(input: z.input<typeof datasetSchema>): Promise<ActionResult<DatasetDetail>> {
  const { user } = await requireAdmin();
  const parsed = datasetSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await action(() =>
    apiJson<DatasetDetail>("datasets", { userId: user.id, method: "POST", body: parsed.data }),
  );
  if (result.ok) refresh();
  return result;
}

const datasetPatchSchema = datasetSchema.omit({ slug: true }).partial().extend({ archived: z.boolean().optional() });

export async function updateDataset(
  datasetId: string,
  input: z.input<typeof datasetPatchSchema>,
): Promise<ActionResult<DatasetDetail>> {
  const { user } = await requireAdmin();
  const parsed = datasetPatchSchema.safeParse(input);
  if (!id.safeParse(datasetId).success) return { ok: false, error: "Unknown dataset." };
  if (!parsed.success) return invalid(parsed.error);
  const result = await action(() =>
    apiJson<DatasetDetail>(`datasets/${datasetId}`, { userId: user.id, method: "PATCH", body: parsed.data }),
  );
  if (result.ok) refresh();
  return result;
}

/** A new draft copied from the latest version (409 `draft_exists` if one is open). */
export async function createDraft(datasetId: string, notes?: string): Promise<ActionResult<VersionDetail>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(datasetId).success) return { ok: false, error: "Unknown dataset." };
  const result = await action(() =>
    apiJson<VersionDetail>(`datasets/${datasetId}/versions`, {
      userId: user.id,
      method: "POST",
      body: { notes: notes?.trim() || null },
    }),
  );
  if (result.ok) refresh();
  return result;
}

export async function publishVersion(versionId: string): Promise<ActionResult<VersionDetail>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(versionId).success) return { ok: false, error: "Unknown version." };
  const result = await action(() =>
    apiJson<VersionDetail>(`dataset-versions/${versionId}/publish`, { userId: user.id, method: "POST" }),
  );
  if (result.ok) refresh();
  return result;
}

export async function addCase(versionId: string, input: CaseInput): Promise<ActionResult<CaseOut>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(versionId).success) return { ok: false, error: "Unknown version." };
  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await action(() =>
    apiJson<CaseOut>(`dataset-versions/${versionId}/cases`, { userId: user.id, method: "POST", body: parsed.data }),
  );
  if (result.ok) refresh();
  return result;
}

export async function updateCase(caseId: string, input: CaseInput): Promise<ActionResult<CaseOut>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(caseId).success) return { ok: false, error: "Unknown case." };
  const parsed = caseSchema.required({ case_key: true }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await action(() =>
    apiJson<CaseOut>(`cases/${caseId}`, { userId: user.id, method: "PATCH", body: parsed.data }),
  );
  if (result.ok) refresh();
  return result;
}

export async function deleteCase(caseId: string): Promise<ActionResult<undefined>> {
  const { user } = await requireAdmin();
  if (!id.safeParse(caseId).success) return { ok: false, error: "Unknown case." };
  const result = await action(() => apiJson<undefined>(`cases/${caseId}`, { userId: user.id, method: "DELETE" }));
  if (result.ok) refresh();
  return result;
}

/** The dashboard's sparklines follow one pinned dataset (a per-browser preference). */
export async function pinDataset(datasetId: string | null): Promise<ActionResult<undefined>> {
  await requireAdmin();
  const store = await cookies();
  if (datasetId === null) {
    store.delete(PINNED_DATASET_COOKIE);
  } else {
    if (!id.safeParse(datasetId).success) return { ok: false, error: "Unknown dataset." };
    store.set(PINNED_DATASET_COOKIE, datasetId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  refresh();
  return { ok: true, data: undefined };
}
