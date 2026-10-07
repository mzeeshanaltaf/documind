/**
 * Shapes returned by the FastAPI `/v1` routes (see api/app/schemas). Client-safe:
 * no server imports, so client islands and Server Components share them.
 */

export type ApiErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

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

export type DocumentRow = {
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

export type OutlineItem = { number: string | null; title: string; page: number; level: number };

export type DocumentDetail = DocumentRow & { summary: string | null; outline: OutlineItem[] | null };

export type UploadItem = {
  file_name: string;
  status: "queued" | "duplicate" | "not_pdf" | "too_large" | "empty";
  document_id: string | null;
  job_id: string | null;
  message: string | null;
};

/** Indexed at least once: answers can cite it (also while a reindex runs). */
export function isSearchable(doc: Pick<DocumentRow, "indexed_at">) {
  return doc.indexed_at !== null;
}

/** Uploaded or processing with a live job: the table polls until it settles. */
export function isInFlight(doc: Pick<DocumentRow, "status" | "job">) {
  return (
    doc.status === "uploaded" ||
    doc.status === "processing" ||
    doc.job?.status === "queued" ||
    doc.job?.status === "running"
  );
}

// --- chat ------------------------------------------------------------------------------------

export type Routing = {
  departments: string[];
  jurisdiction: string | null;
  standalone_query?: string;
  sub_queries?: string[];
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

export type MessageStatus = "complete" | "stopped" | "error" | "streaming";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  sources: Source[] | null;
  routing: Routing | null;
  status: MessageStatus;
  feedback: 1 | -1 | null;
  feedback_comment: string | null;
  created_at: string;
  usage?: MessageUsage | null;
};

export type Conversation = {
  id: string;
  org_id: string;
  title: string | null;
  scope: string;
  document_ids: string[];
  created_at: string;
  updated_at: string;
};

export type ConversationDetail = Conversation & { messages: StoredMessage[] };

// --- settings --------------------------------------------------------------------------------

export type Tier = "standard" | "flex" | "auto";
export type Price = { inputPerMillion: number; cachedInputPerMillion: number; outputPerMillion: number };

export type SettingsValues = {
  chat_model: string;
  router_model: string;
  chat_service_tier: Tier;
  background_service_tier: Tier;
  top_k: number;
};

export type OrgSettings = SettingsValues & {
  overrides: Partial<Record<keyof SettingsValues, unknown>>;
  defaults: SettingsValues;
  models: string[];
  pricing: Record<string, Partial<Record<"standard" | "flex", Price>>>;
  updated_at: string | null;
  updated_by: string | null;
};

// --- analytics -------------------------------------------------------------------------------

export type AnalyticsTotals = {
  requests: number;
  calls: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
  errors: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  p50_ttft_ms: number | null;
  p95_ttft_ms: number | null;
  cache_hit_pct: number;
  messages: number;
};

export type TimeseriesPoint = {
  date: string;
  requests: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number;
  p95_latency_ms: number | null;
};

export type Analytics = {
  range: { from: string; to: string; granularity: "day" | "week"; org_id: string | null };
  totals: AnalyticsTotals;
  timeseries: TimeseriesPoint[];
  by_operation: {
    operation: string;
    calls: number;
    input_tokens: number;
    cached_tokens: number;
    output_tokens: number;
    cost_usd: number;
    avg_latency_ms: number | null;
  }[];
  by_model_tier: {
    model: string;
    tier: string;
    calls: number;
    input_tokens: number;
    cached_tokens: number;
    output_tokens: number;
    cost_usd: number;
    answers: number;
    answer_cost_usd: number;
  }[];
  by_user: { user_id: string; email: string | null; name: string | null; requests: number; tokens: number; cost_usd: number }[];
  by_agent: { agent: string; messages: number; cost_usd: number; up: number; down: number }[];
  top_documents: { doc_code: string | null; title: string | null; document_id: string | null; citations: number; messages: number }[];
  feedback: { up: number; down: number };
};

export type AdminOrg = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  documents: number;
  members: number;
  conversations: number;
  cost_30d_usd: number;
};
