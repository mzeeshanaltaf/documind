/**
 * Shapes returned by DocuMind's FastAPI `/v1` routes (see api/app/schemas). Copied from
 * web/src/lib/api-types.ts (synced 2026-10-22); `Me`/`Org` mirror api/app/schemas/me.py and
 * `DocumentOut` is web's `DocumentRow`. Client-safe: no server imports.
 */

export type ApiErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

// --- me --------------------------------------------------------------------------------------

/** An org the user can open: their memberships, or every org for a platform admin. */
export type Org = {
  id: string;
  name: string;
  slug: string;
  /** `member.role`; null when a platform admin isn't a member. */
  role: string | null;
};

export type Me = {
  user: { id: string; email: string; name: string; is_admin: boolean };
  orgs: Org[];
};

// --- documents -------------------------------------------------------------------------------

export const DEPARTMENTS = [
  "HR",
  "IT",
  "Finance",
  "Procurement",
  "Facilities",
  "Compliance",
  "Corporate",
  "International",
  "Legal",
  "Operations",
  "Other",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DOC_TYPES = [
  "policy_manual",
  "country_supplement",
  "global_supplement",
  "overview",
  "procedure",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type IngestionJob = {
  id: string;
  status: JobStatus;
  stage: string | null;
  progress: number;
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type DocumentOut = {
  id: string;
  title: string;
  doc_code: string | null;
  legal_entity: string | null;
  department: string | null;
  jurisdiction: string | null;
  doc_type: string | null;
  version: string | null;
  effective_date: string | null;
  review_cycle: string | null;
  owner: string | null;
  approved_by: string | null;
  applies_to: string | null;
  related_doc_codes: string[];
  page_count: number | null;
  file_name: string | null;
  file_size: number | null;
  status: DocumentStatus;
  error: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
  chunk_count: number;
  job: IngestionJob | null;
};

export type DocumentList = { documents: DocumentOut[] };

/** Indexed at least once: answers can cite it (also while a reindex runs). */
export function isSearchable(doc: Pick<DocumentOut, "indexed_at">) {
  return doc.indexed_at !== null;
}

// --- chat ------------------------------------------------------------------------------------

export type Routing = {
  departments: string[];
  jurisdiction: string | null;
  standalone_query?: string;
  sub_queries?: string[];
  /** Multi-part questions: each part's own departments and jurisdiction (aligned with sub_queries). */
  parts?: { departments: string[]; jurisdiction: string | null }[];
  bypassed: boolean;
  needs_clarification?: boolean;
  document_ids?: string[];
};

/** A retrieved source. Stored messages carry the full text; live `sources` events don't. */
export type Source = {
  n: number;
  document_id: string;
  doc_code: string | null;
  title: string;
  section_number: string | null;
  section_title: string | null;
  page_start: number | null;
  page_end: number | null;
  jurisdiction: string | null;
  text?: string;
};

export type Citation = Source & {
  chunk_id: string;
  section_path: string[];
  snippet: string;
  highlight_text: string;
};

export type MessageUsage = {
  latency_ms: number | null;
  ttft_ms: number | null;
  cost_usd: number | null;
  input_tokens?: number;
  cached_tokens?: number;
  output_tokens?: number;
};

// --- quota -----------------------------------------------------------------------------------

/** Monthly allowance (UTC calendar month) and what's been used. Platform admins are `unlimited`. */
export type Quota = {
  user_id: string;
  message_limit: number;
  token_limit: number;
  messages_used: number;
  tokens_used: number;
  period_start: string;
  resets_on: string;
  is_custom: boolean;
  unlimited: boolean;
  exhausted: "messages" | "tokens" | null;
};

export const QUOTA_URL = "/api/backend/me/quota";
