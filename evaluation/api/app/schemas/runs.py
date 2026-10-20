import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.judge import pricing
from app.metrics.registry import UnknownMetricError, check_keys
from app.models.enums import RetrievalMode, RunMode
from app.schemas.datasets import CaseOut

RETRIEVAL_MODES: tuple[RetrievalMode, ...] = ("bm25", "vector", "hybrid")


class Overrides(BaseModel):
    """Per-run DocuMind overrides (E1 chat `overrides`; `/retrieve` takes top_k, router_model and
    chat_service_tier)."""

    model_config = ConfigDict(extra="forbid")

    top_k: int | None = Field(default=None, ge=1, le=30)
    retrieval_mode: RetrievalMode | None = None
    chat_model: str | None = Field(default=None, min_length=1, max_length=100)
    router_model: str | None = Field(default=None, min_length=1, max_length=100)
    chat_service_tier: Literal["standard", "flex", "auto"] | None = None


class MetricsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: list[str] | None = Field(default=None, description="null = every metric")
    thresholds: dict[str, float] = Field(default_factory=dict)
    gates: list[str] | None = Field(default=None, description="null = citation_validity, leakage")

    @model_validator(mode="after")
    def _known(self) -> "MetricsIn":
        try:
            check_keys([*(self.enabled or []), *self.thresholds, *(self.gates or [])])
        except UnknownMetricError as exc:
            raise ValueError(str(exc)) from exc
        return self


Effort = Literal["low", "medium", "high", "xhigh", "max"]


def _priced(model: str | None) -> str | None:
    if model is not None and not pricing.known(model):
        raise ValueError(f"{model!r} has no entry in judge-pricing.json")
    return model


class JudgeModels(BaseModel):
    """Per role: `rubric` = the rubric prompts (answer quality, follow-up), `claims` = the claim
    checks (claims, key facts, relevance, behaviour). None = the prompt file's own model (Haiku
    5.5 for both roles)."""

    model_config = ConfigDict(extra="forbid")

    rubric: str | None = None
    claims: str | None = None

    @field_validator("rubric", "claims")
    @classmethod
    def _known(cls, value: str | None) -> str | None:
        return _priced(value)


class JudgeEfforts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rubric: Effort | None = None
    claims: Effort | None = None


class JudgeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=True, description="false = deterministic metrics only.")
    models: JudgeModels = Field(default_factory=JudgeModels)
    samples: Literal[1, 3] = Field(default=1, description="answer_quality samples (median).")
    efforts: JudgeEfforts = Field(default_factory=JudgeEfforts)


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_version_id: uuid.UUID
    org_slug: str | None = Field(default=None, description="Default: the dataset's default org.")
    mode: RunMode = "full"
    overrides: Overrides = Field(default_factory=Overrides)
    retrieval_modes: list[RetrievalMode] | None = Field(
        default=None, description="retrieval_only: default all three."
    )
    metrics: MetricsIn = Field(default_factory=MetricsIn)
    judge: JudgeIn = Field(default_factory=JudgeIn)
    name: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)
    max_judge_cost_usd: float | None = Field(default=None, ge=0)
    cleanup_conversations: bool = True
    canary_phrases: list[str] = Field(default_factory=list, max_length=50)

    @field_validator("retrieval_modes")
    @classmethod
    def _modes(cls, value: list[RetrievalMode] | None) -> list[RetrievalMode] | None:
        if value is None:
            return None
        if not value:
            raise ValueError("retrieval_modes cannot be empty")
        return [mode for mode in RETRIEVAL_MODES if mode in value]  # dedupe, canonical order

    @model_validator(mode="after")
    def _mode_fields(self) -> "RunIn":
        if self.mode == "full" and self.retrieval_modes is not None:
            raise ValueError("retrieval_modes only applies to retrieval_only runs")
        if self.mode == "retrieval_only" and (
            self.overrides.retrieval_mode or self.overrides.chat_model
        ):
            raise ValueError(
                "retrieval_only runs take retrieval_modes, not overrides.retrieval_mode/chat_model"
            )
        return self


class RejudgeIn(BaseModel):
    """Re-score a finished full run with another judge config: no DocuMind calls."""

    model_config = ConfigDict(extra="forbid")

    judge: JudgeIn = Field(default_factory=JudgeIn)
    metrics: MetricsIn | None = Field(default=None, description="Default: the source run's.")
    name: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)
    max_judge_cost_usd: float | None = Field(default=None, ge=0)
    tamper: Literal["judge_robustness"] | None = Field(
        default=None,
        description="judge_robustness: append evaluator-directed text (fixtures/"
        "judge-robustness.txt) to every copied answer, to check the judge ignores it.",
    )


class ResumeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_judge_cost_usd: float | None = Field(
        default=None, ge=0, description="A new judge budget (needed after a `budget` pause)."
    )


class DatasetVersionRef(BaseModel):
    dataset_id: uuid.UUID
    slug: str
    name: str
    version: int


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    dataset_version_id: uuid.UUID
    dataset: DatasetVersionRef | None = None
    org_id: str
    org_slug: str
    mode: str
    status: str
    status_reason: str | None
    source_run_id: uuid.UUID | None
    config: dict[str, Any]
    config_hash: str
    total_cases: int
    done_cases: int
    failed_cases: int
    skipped_cases: int
    passed_cases: int
    documind_cost_usd: float
    documind_cost_reported_usd: float | None
    judge_cost_usd: float
    max_judge_cost_usd: float | None
    partial: bool
    tags: list[str]
    created_by: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None


class RunListOut(BaseModel):
    runs: list[RunOut]
    total: int


class AggregateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    metric: str
    mode: str
    slice: str
    n: int
    mean: float | None
    ci_low: float | None
    ci_high: float | None
    ci_method: str | None
    pass_rate: float | None
    details: dict[str, Any]


class RunDetailOut(RunOut):
    snapshot: dict[str, Any]
    case_status_counts: dict[str, int]
    aggregates: list[AggregateOut] = Field(description="The `all` slice; see /aggregates.")


class RunCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_id: uuid.UUID
    case_key: str
    type: str | None = None
    question: str | None = None
    status: str
    attempt: int
    passed: bool | None
    needs_clarification: bool | None
    latency_ms: int | None
    ttft_ms: int | None
    documind_cost_usd: float | None
    error_stage: str | None
    error: str | None
    updated_at: datetime
    metrics: dict[str, dict[str, float | None]] = Field(
        default_factory=dict, description="mode → metric → value"
    )


class RunCaseListOut(BaseModel):
    cases: list[RunCaseOut]
    total: int


class MetricScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    metric: str
    mode: str
    value: float | None
    passed: bool | None
    status: str
    n_samples: int
    spread: float | None
    details: dict[str, Any]


class ContextOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mode: str
    rank: int
    n: int
    chunk_id: uuid.UUID | None
    document_id: uuid.UUID | None
    doc_code: str | None
    section_number: str | None
    section_title: str | None
    section_path: list[str]
    page_start: int | None
    page_end: int | None
    content_type: str | None
    department: str | None
    jurisdiction: str | None
    text: str | None
    bm25_rank: int | None
    vector_rank: int | None
    rrf: float | None
    score: float | None
    part: int | None
    label_relevant: bool | None
    judge_relevant: bool | None
    cited: bool | None


class ClaimOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    idx: int
    text: str
    sentence_idx: int | None
    citation_ns: list[int]
    verdict: str | None
    supporting_ns: list[int]
    evidence_quote: str | None
    reasoning: str | None


class JudgeCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    purpose: str
    model: str
    model_actual: str | None
    effort: str | None
    sample_idx: int
    input_tokens: int
    cache_write_tokens: int
    cache_read_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int | None
    stop_reason: str | None
    status: str
    error: str | None
    created_at: datetime


class SafetyCaseOut(BaseModel):
    run_case_id: uuid.UUID
    case_key: str
    type: str
    question: str
    value: float | None
    status: str
    bad: bool = Field(description="A leak, a followed injection, a missed refusal, a failed probe…")
    details: dict[str, Any]


class SafetyMetricOut(BaseModel):
    metric: str
    n: int = Field(default=0, description="Cases with an `ok` score.")
    bad: int = 0
    mean: float | None = None
    na: int = 0
    errors: int = Field(default=0, description="Scores with status error or refusal.")
    cases: list[SafetyCaseOut] = Field(default_factory=list)


class SafetyOut(BaseModel):
    mode: str
    metrics: dict[str, SafetyMetricOut]
    probe_errors: list[SafetyCaseOut] = Field(
        default_factory=list, description="authz_probe cases that errored before a score."
    )


class RunCaseDetailOut(RunCaseOut):
    correlation_id: str
    conversation_id: uuid.UUID | None
    answer: str | None
    routing: dict[str, Any] | None
    citations: list[dict[str, Any]] | None
    trace: dict[str, Any] | None
    input_tokens: int | None
    cached_tokens: int | None
    output_tokens: int | None
    documind_usage: dict[str, Any] | None
    judge_cost_usd: float
    case: CaseOut
    scores: list[MetricScoreOut]
    contexts: list[ContextOut]
    claims: list[ClaimOut] = Field(default_factory=list)
    judge_calls: list[JudgeCallOut] = Field(default_factory=list)
