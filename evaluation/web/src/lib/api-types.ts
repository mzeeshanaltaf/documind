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

/** One request of an `authz_probe` case (E8), sent as the non-admin probe user. */
export type ProbeRequest = {
  name: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body: Record<string, unknown> | null;
  eval_headers: boolean;
  expect: number;
};

/** What a probe request got back (`authz_probe` details and the case trace). */
export type ProbeResult = {
  name: string;
  method: string;
  path: string;
  url: string;
  eval_headers: boolean;
  expect: number;
  status: number | null;
  code: string | null;
  ok: boolean;
  ms: number | null;
  error?: string;
};

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
  /** authz_probe cases only; absent from older exports. */
  probes?: ProbeRequest[] | null;
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
  /** Deterministic, then recomputed with the judge's verdict (injection_resisted). */
  judge_refined?: boolean;
  run_modes: string[];
  description: string;
};

// --- safety (E8) ------------------------------------------------------------------------------

export type SafetyCase = {
  run_case_id: string;
  case_key: string;
  type: string;
  question: string;
  value: number | null;
  status: string;
  bad: boolean;
  details: Record<string, unknown>;
};

export type SafetyMetric = {
  metric: string;
  n: number;
  bad: number;
  mean: number | null;
  na: number;
  errors: number;
  cases: SafetyCase[];
};

export type SafetySummary = {
  mode: string;
  metrics: Record<string, SafetyMetric>;
  probe_errors: SafetyCase[];
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

// --- synthetic test sets (E7) ----------------------------------------------------------------------

export const SYNTHETIC_TYPES = [
  "single_hop",
  "multi_hop",
  "jurisdiction",
  "comparative",
  "unanswerable",
  "out_of_scope",
] as const;
export type SyntheticType = (typeof SYNTHETIC_TYPES)[number];
export type BatchKind = "synthetic" | "enrichment";
export type BatchStatus = "generating" | "paused" | "review";
export type CandidateStatus = "pending" | "approved" | "rejected";
export const GENERATOR_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;

/** A DocuMind document as the passthrough returns it (only what the forms read). */
export type DocumindDocument = {
  id: string;
  title: string;
  doc_code: string | null;
  department: string | null;
  jurisdiction: string | null;
  doc_type: string | null;
  status: string | null;
};

export type BatchCounts = {
  total: number;
  queued: number;
  pending: number;
  approved: number;
  rejected: number;
  auto_rejected: number;
  committed: number;
};

export type SyntheticBatch = {
  id: string;
  name: string | null;
  kind: BatchKind;
  org_id: string;
  org_slug: string;
  target_dataset_id: string | null;
  target_dataset: DatasetRef | null;
  source_version_id: string | null;
  config: {
    seed?: number;
    generator_model?: string | null;
    validator_model?: string | null;
    type_counts?: Partial<Record<SyntheticType, number>>;
    shortfall?: Partial<Record<SyntheticType, number>>;
    doc_codes?: string[];
    eligible_chunks?: number;
    dataset_version?: number;
    skipped?: { case_key: string; reason: string }[];
  };
  status: BatchStatus;
  status_reason: string | null;
  prompt_version_ids: Record<string, { version_id: string; sha256: string; version: number }>;
  cost_usd: number;
  max_cost_usd: number | null;
  estimate_usd: number;
  candidate_count: number;
  generated_count: number;
  failed_count: number;
  counts: BatchCounts;
  by_type: Record<string, BatchCounts>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  committed_at: string | null;
  committed_version_id: string | null;
};

export type SourceExcerpt = {
  n: number;
  role: "seed" | "retrieved";
  chunk_id: string;
  doc_code: string | null;
  title: string | null;
  department: string | null;
  jurisdiction: string | null;
  section_number: string | null;
  section_title: string | null;
  page_start: number | null;
  page_end: number | null;
  text: string;
};

export type CandidateChecks = {
  failures?: string[];
  warnings?: string[];
  overlap?: number;
  duplicate?: { label: string; question: string; score: number };
  sections?: {
    ok: boolean;
    malformed: string[];
    unknown_sections: string[];
    unknown_doc_codes: string[];
    unlisted_codes: string[];
  };
  has_sections?: boolean;
  quotes?: { count: number; missing: string[] };
  validation?: {
    status: string;
    error?: string | null;
    model?: string | null;
    reasoning?: string;
    answerable_from_sources?: boolean;
    reference_supported?: boolean;
    self_contained?: boolean;
    ambiguity?: "low" | "medium" | "high";
    issues?: string[];
    keep?: boolean;
  };
  retrieval?: { n: number; section: string | null }[];
  retrieval_error?: string;
  generation_error?: string;
  generator_model?: string | null;
  chunk_count?: number;
  missing_sections?: string[];
};

export type Candidate = {
  id: string;
  batch_id: string;
  ordinal: number;
  type: CaseType;
  gen_status: "queued" | "generated" | "failed";
  status: CandidateStatus;
  seed: { hints?: Record<string, string>; sections?: string[] };
  question: string | null;
  setup_turns: string[];
  reference_answer: string | null;
  key_facts: KeyFact[];
  expected_doc_codes: string[];
  expected_sections: string[];
  expected_pages: unknown;
  expected_departments: string[];
  expected_jurisdiction: string | null;
  expected_behavior: ExpectedBehavior;
  source_chunk_ids: string[];
  source_excerpt: SourceExcerpt[];
  evidence_quotes: string[];
  rationale: string | null;
  checks: CandidateChecks;
  auto_rejected: boolean;
  reject_reason: string | null;
  edited: boolean;
  target_case_key: string | null;
  error: string | null;
  cost_usd: number;
  reviewer_id: string | null;
  reviewed_at: string | null;
  case_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidatePatch = Partial<
  Pick<
    Candidate,
    | "reference_answer"
    | "key_facts"
    | "expected_doc_codes"
    | "expected_sections"
    | "expected_jurisdiction"
    | "expected_behavior"
  > & { question: string }
>;

export type CommitResult = {
  dataset: DatasetRef;
  version: VersionOut;
  added: number;
  updated: number;
  skipped: { candidate_id: string; reason: string }[];
};

// --- review & calibration (E9) ---------------------------------------------------------------------

export const REVIEW_SAMPLINGS = ["stratified", "random", "disagreement"] as const;
export type ReviewSampling = (typeof REVIEW_SAMPLINGS)[number];
/** The judge metrics people can grade (the eval API's `services/review.REVIEWABLE`). */
export const REVIEWABLE_METRICS = [
  "answer_quality.correctness",
  "answer_quality.completeness",
  "answer_quality.relevance",
  "answer_quality.jurisdiction_handling",
  "answer_quality.refusal_helpfulness",
  "answer_quality",
  "followup_resolution",
  "behavior_correct",
  "faithfulness",
] as const;
export const CALIBRATION_STATUSES = ["uncalibrated", "unreliable", "moderate", "calibrated", "stale"] as const;
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

export type ReviewProgress = {
  total: number;
  done: number;
  skipped: number;
  mine_done: number;
  mine_skipped: number;
  mine_remaining: number;
  double_graded: number;
};

export type ReviewQueue = {
  id: string;
  run_id: string;
  run_name: string | null;
  name: string;
  metrics: string[];
  sampling: ReviewSampling;
  seed: number;
  size: number;
  blind: boolean;
  details: {
    eligible?: number;
    stratified_by?: string;
    available?: Record<string, number>;
    picked?: Record<string, number>;
  };
  created_by: string | null;
  created_at: string;
  progress: ReviewProgress | null;
};

export type ReviewItemSummary = {
  id: string;
  position: number;
  status: "pending" | "done" | "skipped";
  case_key: string;
  run_case_id: string;
  reviewers: number;
  mine_done: boolean;
  mine_skipped: boolean;
};

export type ReviewQueueDetail = ReviewQueue & { items: ReviewItemSummary[] };

export type ReviewSource = {
  n: number;
  header: string;
  doc_code: string | null;
  title: string | null;
  section_number: string | null;
  section_title: string | null;
  page_start: number | null;
  page_end: number | null;
  jurisdiction: string | null;
  text: string;
};

export type ReviewMetric = {
  key: string;
  kind: "ordinal" | "binary" | "claims";
  /** The statistics' categories, in order. */
  labels: string[];
  /** What the reviewer picks: the labels, or behaviour classes for behavior_correct. */
  choices: string[];
  description: string;
};

export type RubricAnchor = { label: string; text: string };
export type Rubric = {
  section: string;
  groups: { key: string | null; description: string; anchors: RubricAnchor[] }[];
  notes: string[];
  prompt: string;
  prompt_version: number | null;
};

export type MyReview = {
  metric: string;
  value: number | null;
  label: string | null;
  comment: string | null;
  claim_verdicts: Record<string, string> | null;
  updated_at: string;
};

export type JudgeClaimView = {
  idx: number;
  verdict: string | null;
  reasoning: string | null;
  evidence_quote: string | null;
  supporting_ns: number[];
};

export type JudgeView = {
  value: number | null;
  label: string | null;
  n_samples: number;
  spread: number | null;
  /** A dimension's analysis, the verdict's summary, the behaviour or follow-up reasoning. */
  reasoning?: string | null;
  samples?: number[] | null;
  issues?: { severity: string; dimension: string; quote: string; explanation: string }[] | null;
  choice?: string | null;
  claims?: JudgeClaimView[];
};

export type ReviewItem = {
  id: string;
  queue_id: string;
  position: number;
  status: string;
  run_id: string;
  run_case_id: string;
  case_key: string;
  case_type: string;
  packet: {
    question: string;
    conversation: { role: string; content: string }[];
    expected_behavior: string;
    expected_behavior_text: string;
    reference_answer: string | null;
    key_facts: KeyFact[];
    standalone_query: string | null;
    sources: ReviewSource[];
    answer: string;
  };
  metrics: ReviewMetric[];
  rubrics: Record<string, Rubric>;
  claims: { idx: number; text: string; citation_ns: number[] }[];
  mine: Record<string, MyReview>;
  revealed: boolean;
  locked: boolean;
  judge: Record<string, JudgeView> | null;
};

export type ReviewNext = { item: ReviewItem | null; progress: ReviewProgress };
export type ReviewGrade = {
  metric: string;
  label?: string | null;
  comment?: string | null;
  claim_verdicts?: Record<string, string> | null;
};

export type Calibration = {
  id: string;
  metric: string;
  prompt_key: string;
  prompt_version: number;
  prompt_version_id: string;
  judge_model: string;
  n: number;
  kappa: number | null;
  kappa_weighted: number | null;
  spearman: number | null;
  exact_pct: number | null;
  within1_pct: number | null;
  mae: number | null;
  bias: number | null;
  human_kappa: number | null;
  confusion: { labels?: string[]; matrix?: number[][] };
  details: {
    kind?: "ordinal" | "binary" | "claims";
    primary?: "kappa_weighted" | "kappa";
    units?: number;
    /** Category index pairs [judge, human], or per-case faithfulness values. */
    pairs?: [number, number][];
    human?: { n: number; kappa: number | null };
    retest?: { n: number; mean_spread_steps: number };
  };
  status: Exclude<CalibrationStatus, "stale">;
  current: boolean;
  computed_at: string;
};

export type CalibrationBadge = {
  metric: string;
  reviewable: boolean;
  status: CalibrationStatus;
  n: number;
  kappa: number | null;
  primary: "kappa_weighted" | "kappa" | null;
  calibration_id: string | null;
  prompt_version: number | null;
  judge_model: string | null;
  latest: {
    calibration_id: string;
    prompt_version: number;
    judge_model: string;
    status: string;
    n: number;
    kappa: number | null;
  } | null;
};

export type CalibrationList = {
  rows: Calibration[];
  current: CalibrationBadge[];
  thresholds: { min_n: number; calibrated_n: number; unreliable_below: number; calibrated_from: number };
};
