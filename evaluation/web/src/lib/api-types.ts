/**
 * Shapes of the eval API (`evaluation/api/app/schemas/*`). Keep in sync by hand: the API is the
 * source of truth. Dates are ISO strings; ids are uuids unless noted.
 */

export type ApiErrorBody = { error?: { code?: string; message?: string; details?: unknown } };

// --- enums (app/models/enums.py) ------------------------------------------------------------

export const CASE_TYPES = [
  "single_hop",
  "multi_hop",
  "jurisdiction",
  "comparative",
  "unanswerable",
  "out_of_scope",
  "clarification",
  "injection",
  "leakage",
  "jurisdiction_confusion",
  "multi_turn",
  "authz_probe",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const EXPECTED_BEHAVIORS = ["answer", "refuse", "clarify", "clarify_or_variations", "answer_ignoring_injection"] as const;
export type ExpectedBehavior = (typeof EXPECTED_BEHAVIORS)[number];

export const DATASET_KINDS = ["golden", "synthetic", "adversarial", "mixed"] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CASE_SOURCES = ["manual", "imported", "synthetic", "adversarial"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

export const RUN_STATUSES = ["running", "pausing", "paused", "stopping", "stopped", "finalizing", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ["completed", "failed"];

export const RUN_CASE_STATUSES = ["pending", "generating", "generated", "judging", "done", "error", "skipped"] as const;
export type RunCaseStatus = (typeof RUN_CASE_STATUSES)[number];

export const RETRIEVAL_MODES = ["bm25", "vector", "hybrid"] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

// --- datasets --------------------------------------------------------------------------------

export type KeyFact = { fact: string; weight: number };

export type CaseFields = {
  case_key: string;
  type: CaseType;
  question: string;
  setup_turns: string[];
  reference_answer: string | null;
  key_facts: KeyFact[];
  expected_doc_codes: string[];
  expected_sections: string[];
  expected_pages: unknown;
  expected_departments: string[];
  expected_jurisdiction: string | null;
  expected_behavior: ExpectedBehavior;
  scope_doc_codes: string[];
  forbidden_doc_codes: string[];
  injection_canary: string | null;
  expected_standalone_query: string | null;
  tags: string[];
  difficulty: Difficulty | null;
  source: CaseSource;
  notes: string | null;
};

export type CaseOut = CaseFields & {
  id: string;
  dataset_version_id: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type VersionOut = {
  id: string;
  dataset_id: string;
  version: number;
  status: "draft" | "published";
  case_count: number;
  content_hash: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
};

export type DatasetRef = { id: string; slug: string; name: string; default_org_slug: string | null };

export type VersionDetail = VersionOut & { dataset: DatasetRef };

export type DatasetOut = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  default_org_slug: string | null;
  kind: DatasetKind;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  latest_version: VersionOut | null;
  latest_published: VersionOut | null;
};

export type DatasetDetail = DatasetOut & { versions: VersionOut[] };

export type ImportResult = {
  preview: boolean;
  cases: CaseFields[];
  errors: { line: number; message: string }[];
  warnings: string[];
  dataset: DatasetRef | null;
  version: VersionOut | null;
  unchanged: boolean;
};

// --- runs ------------------------------------------------------------------------------------

export type DatasetVersionRef = { dataset_id: string; slug: string; name: string; version: number };

export type RunOut = {
  id: string;
  name: string | null;
  dataset_version_id: string;
  dataset: DatasetVersionRef | null;
  org_id: string;
  org_slug: string;
  mode: "full" | "retrieval_only";
  status: RunStatus;
  status_reason: string | null;
  source_run_id: string | null;
  config: RunConfig;
  config_hash: string;
  total_cases: number;
  done_cases: number;
  failed_cases: number;
  skipped_cases: number;
  passed_cases: number;
  documind_cost_usd: number;
  documind_cost_reported_usd: number | null;
  judge_cost_usd: number;
  max_judge_cost_usd: number | null;
  partial: boolean;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
};

/** The stored run config (a superset of RunIn after defaults). Loosely typed on purpose. */
export type RunConfig = {
  overrides?: Record<string, unknown>;
  retrieval_modes?: RetrievalMode[] | null;
  metrics?: { enabled?: string[] | null; thresholds?: Record<string, number>; gates?: string[] | null };
  judge?: { enabled?: boolean; models?: Record<string, string | null>; samples?: number; efforts?: Record<string, string | null> };
  [key: string]: unknown;
};

export type AggregateOut = {
  metric: string;
  mode: string;
  slice: string;
  n: number;
  mean: number | null;
  ci_low: number | null;
  ci_high: number | null;
  ci_method: "bootstrap" | "wilson" | null;
  pass_rate: number | null;
  details: Record<string, unknown>;
};

export type RunDetail = RunOut & {
  snapshot: Record<string, unknown>;
  case_status_counts: Partial<Record<RunCaseStatus, number>>;
  aggregates: AggregateOut[];
};

/** mode → metric → value */
export type MetricValues = Record<string, Record<string, number | null>>;

export type RunCaseOut = {
  id: string;
  case_id: string;
  case_key: string;
  type: CaseType | null;
  question: string | null;
  status: RunCaseStatus;
  attempt: number;
  passed: boolean | null;
  needs_clarification: boolean | null;
  latency_ms: number | null;
  ttft_ms: number | null;
  documind_cost_usd: number | null;
  error_stage: string | null;
  error: string | null;
  updated_at: string;
  metrics: MetricValues;
};

export type MetricScoreOut = {
  metric: string;
  mode: string;
  value: number | null;
  passed: boolean | null;
  status: "ok" | "na" | "error" | "refusal";
  n_samples: number;
  spread: number | null;
  details: Record<string, unknown>;
};

export type ContextOut = {
  mode: string;
  rank: number;
  n: number;
  chunk_id: string | null;
  document_id: string | null;
  doc_code: string | null;
  section_number: string | null;
  section_title: string | null;
  section_path: string[];
  page_start: number | null;
  page_end: number | null;
  content_type: string | null;
  department: string | null;
  jurisdiction: string | null;
  text: string | null;
  bm25_rank: number | null;
  vector_rank: number | null;
  rrf: number | null;
  score: number | null;
  part: number | null;
  label_relevant: boolean | null;
  judge_relevant: boolean | null;
  cited: boolean | null;
};

export type ClaimOut = {
  idx: number;
  text: string;
  sentence_idx: number | null;
  citation_ns: number[];
  verdict: "supported" | "contradicted" | "not_found" | null;
  supporting_ns: number[];
  evidence_quote: string | null;
  reasoning: string | null;
};

export type Routing = {
  departments?: string[];
  jurisdiction?: string | null;
  standalone_query?: string;
  parts?: { query: string; departments?: string[]; jurisdiction?: string | null }[];
  needs_clarification?: boolean;
  clarifying_question?: string | null;
  bypassed?: boolean;
  sub_queries?: string[];
  [key: string]: unknown;
};

export type Citation = {
  n: number;
  doc_code?: string | null;
  title?: string;
  section_number?: string | null;
  section_title?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  snippet?: string | null;
  highlight_text?: string | null;
};

export type RunCaseDetail = RunCaseOut & {
  correlation_id: string;
  conversation_id: string | null;
  answer: string | null;
  routing: Routing | null;
  citations: Citation[] | null;
  trace: Record<string, unknown> | null;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  documind_usage: Record<string, unknown> | null;
  judge_cost_usd: number;
  case: CaseOut;
  scores: MetricScoreOut[];
  contexts: ContextOut[];
  claims: ClaimOut[];
  judge_calls: JudgeCallOut[];
};

/** `run` SSE event (routers/runs.py › run_event). */
export type RunEvent = Pick<
  RunOut,
  | "id"
  | "status"
  | "status_reason"
  | "total_cases"
  | "done_cases"
  | "failed_cases"
  | "skipped_cases"
  | "passed_cases"
  | "documind_cost_usd"
  | "judge_cost_usd"
  | "partial"
  | "finished_at"
  | "error"
>;

export type MetricInfo = {
  key: string;
  group: string;
  scale: string;
  direction: "higher" | "lower" | string;
  default_threshold: number | null;
  gating: boolean;
  requires_judge: boolean;
  run_modes: string[];
  description: string;
};

export type JudgeCallOut = {
  id: string;
  purpose: string;
  model: string;
  model_actual: string | null;
  effort: string | null;
  sample_idx: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  stop_reason: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

// --- DocuMind passthrough, prompts, system ----------------------------------------------------

export type OrgAccess = { id: string; slug: string; name: string; role?: string | null };

export type PromptVersionSummary = {
  id: string;
  version: number;
  sha256: string;
  model: string;
  effort: string | null;
  thinking: string | null;
  params: Record<string, unknown>;
  created_at: string;
};

export type PromptVersion = PromptVersionSummary & { body: string; output_schema: Record<string, unknown> | null };

export type PromptOut = {
  key: string;
  kind: string;
  description: string | null;
  versions: number;
  latest: PromptVersionSummary | null;
  current_version: number | null;
  file_present: boolean;
};

export type PromptDiff = { key: string; from_version: number; to_version: number; diff: string };

export type ServiceUser = {
  role: "service" | "probe";
  id: string | null;
  found: boolean;
  email: string | null;
  name: string | null;
  is_admin: boolean;
  banned: boolean;
};

export type SystemInfo = {
  eval: {
    version: string;
    judge_pricing_sha256: string | null;
    judge_models: string[];
    auth_schema: string;
    db_schema: string;
    worker_slots: number;
    documind_concurrency: number;
    judge_concurrency: number;
  };
  documind: {
    reachable: boolean;
    error?: string;
    url?: string;
    version?: string | null;
    pricing_sha256?: string | null;
    prompt_hashes?: Record<string, string>;
    chat_models?: string[];
    defaults?: Record<string, unknown>;
  };
  anthropic: { configured: boolean; reachable: boolean; error?: string };
  service_users: ServiceUser[];
  spend: { since: string; judge_usd: number; documind_usd: number; runs: number };
};

export type HealthOut = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  version: string;
  documind: { reachable: boolean; version: string | null };
};

export type TrendPoint = {
  run_id: string;
  finished_at: string | null;
  mode: string;
  mean: number | null;
  ci_low: number | null;
  ci_high: number | null;
  n: number;
};
export type TrendRun = {
  run_id: string;
  name: string | null;
  finished_at: string | null;
  dataset_version_id: string;
  dataset_slug: string;
  dataset_version: number | null;
  config_hash: string;
  documind_version: string | null;
  source_run_id: string | null;
};
export type ChangeKind = "config" | "documind" | "prompt" | "dataset";
export type MarkerChange = { kind: ChangeKind; key: string; a: unknown; b: unknown };
export type TrendMarker = {
  run_id: string;
  previous_run_id: string;
  finished_at: string | null;
  kinds: ChangeKind[];
  changes: MarkerChange[];
};
export type Trends = {
  run_mode: "full" | "retrieval_only" | null;
  runs: TrendRun[];
  series: Record<string, TrendPoint[]>;
  markers: TrendMarker[];
  slices: string[];
};

// --- compare (E6) ----------------------------------------------------------------------------

export type CompareMetric = {
  key: string;
  group: string;
  scale: MetricInfo["scale"];
  direction: "higher" | "lower";
  test: "mcnemar" | "permutation";
  n: number;
  n_missing: number;
  mean_a: number | null;
  mean_b: number | null;
  delta: number | null;
  ci: [number, number] | null;
  p: number | null;
  /** False for operational metrics: descriptive only (they follow the prompt cache and load). */
  in_family: boolean;
  p_holm: number | null;
  significant: boolean;
  direction_good: boolean | null;
  discordant: { a_only: number; b_only: number } | null;
  noise_delta: number | null;
  within_noise: boolean | null;
};

export type CaseClass = "improved" | "regressed" | "mixed" | "unchanged" | "unpaired";

export type CompareCase = {
  case_key: string;
  question: string;
  type: string;
  run_case_id_a: string | null;
  run_case_id_b: string | null;
  status_a: RunCaseStatus | null;
  status_b: RunCaseStatus | null;
  passed_a: boolean | null;
  passed_b: boolean | null;
  values: Record<string, [number | null, number | null]>;
  deltas: Record<string, number | null>;
  changes: Record<string, "improved" | "regressed">;
  class: CaseClass;
};

export type Comparison = {
  a: RunOut;
  b: RunOut;
  mode: string;
  config_diff: { key: string; a: unknown; b: unknown }[];
  warnings: string[];
  noise_floor: {
    run_a: string;
    run_b: string;
    is_self: boolean;
    paired: number;
    flip_rate: number | null;
    metrics: Record<string, number>;
  } | null;
  pairing: {
    paired: number;
    only_a: number;
    only_b: number;
    not_done: number;
    classes: Record<CaseClass, number>;
    flip_rate: number | null;
  };
  metrics: CompareMetric[];
  cases: CompareCase[];
};
