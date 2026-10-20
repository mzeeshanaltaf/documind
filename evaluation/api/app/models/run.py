import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    PrimaryKeyConstraint,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import (
    text as sql_text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UpdatedAt, UuidPk, in_values
from app.models.dataset import EMPTY_TEXT_ARRAY
from app.models.enums import (
    CiMethod,
    ClaimVerdict,
    JudgeCallStatus,
    MetricMode,
    MetricStatus,
    RetrievalMode,
    RunCaseStatus,
    RunMode,
    RunStatus,
    values,
)

USD = Numeric(14, 8)  # DocuMind's llm_usage.cost_usd precision
ZERO = sql_text("0")
EMPTY_JSON = sql_text("'{}'::jsonb")


class Run(UuidPk, CreatedAt, UpdatedAt, Base):
    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(in_values("mode", values(RunMode)), name="mode"),
        CheckConstraint(in_values("status", values(RunStatus)), name="status"),
        Index("ix_runs_dataset_version_id_created_at", "dataset_version_id", "created_at"),
    )

    name: Mapped[str | None] = mapped_column(Text)
    dataset_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dataset_versions.id", ondelete="RESTRICT")
    )
    org_id: Mapped[str] = mapped_column(Text)
    org_slug: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="running")
    status_reason: Mapped[str | None] = mapped_column(Text)  # e.g. `budget` (E4)
    source_run_id: Mapped[uuid.UUID | None] = mapped_column(  # rejudge (E4)
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="SET NULL")
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=EMPTY_JSON)
    config_hash: Mapped[str] = mapped_column(Text)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=EMPTY_JSON)
    total_cases: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    done_cases: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    failed_cases: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    skipped_cases: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    passed_cases: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    documind_cost_usd: Mapped[Decimal] = mapped_column(USD, server_default=ZERO)
    # What DocuMind's /admin/eval-runs/{id}/usage reported at finalize (reconciliation).
    documind_cost_reported_usd: Mapped[Decimal | None] = mapped_column(USD)
    judge_cost_usd: Mapped[Decimal] = mapped_column(USD, server_default=ZERO)
    max_judge_cost_usd: Mapped[Decimal | None] = mapped_column(USD)
    partial: Mapped[bool] = mapped_column(Boolean, server_default=sql_text("false"))
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)
    created_by: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)


class RunCase(UuidPk, CreatedAt, Base):
    __tablename__ = "run_cases"
    __table_args__ = (
        UniqueConstraint("run_id", "case_id"),
        CheckConstraint(in_values("status", values(RunCaseStatus)), name="status"),
        Index("ix_run_cases_run_id_updated_at", "run_id", "updated_at"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE")
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="RESTRICT"), index=True
    )
    case_key: Mapped[str] = mapped_column(Text)  # denormalized: pairing (E6) and request ids
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    attempt: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    correlation_id: Mapped[str] = mapped_column(Text)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    answer: Mapped[str | None] = mapped_column(Text)
    routing: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    needs_clarification: Mapped[bool | None] = mapped_column(Boolean)
    trace: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    ttft_ms: Mapped[int | None] = mapped_column(Integer)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    cached_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    documind_cost_usd: Mapped[Decimal | None] = mapped_column(USD)
    documind_usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    judge_cost_usd: Mapped[Decimal] = mapped_column(USD, server_default=ZERO)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    error_stage: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    # The progress stream's cursor (E3), so it is bumped on every write.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class RetrievedContext(UuidPk, CreatedAt, Base):
    __tablename__ = "retrieved_contexts"
    __table_args__ = (
        UniqueConstraint("run_case_id", "mode", "rank"),
        CheckConstraint(in_values("mode", values(RetrievalMode)), name="mode"),
    )

    run_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE")
    )
    mode: Mapped[str] = mapped_column(Text)
    rank: Mapped[int] = mapped_column(Integer)
    n: Mapped[int] = mapped_column(Integer)
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    doc_code: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)  # the judge renders sources like DocuMind
    owner: Mapped[str | None] = mapped_column(Text)
    section_number: Mapped[str | None] = mapped_column(Text)
    section_title: Mapped[str | None] = mapped_column(Text)
    section_path: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    content_type: Mapped[str | None] = mapped_column(Text)
    department: Mapped[str | None] = mapped_column(Text)
    jurisdiction: Mapped[str | None] = mapped_column(Text)
    text: Mapped[str | None] = mapped_column(Text)
    bm25_rank: Mapped[int | None] = mapped_column(Integer)
    vector_rank: Mapped[int | None] = mapped_column(Integer)
    rrf: Mapped[float | None] = mapped_column(Float)
    score: Mapped[float | None] = mapped_column(Float)
    part: Mapped[int | None] = mapped_column(Integer)
    label_relevant: Mapped[bool | None] = mapped_column(Boolean)
    judge_relevant: Mapped[bool | None] = mapped_column(Boolean)
    cited: Mapped[bool | None] = mapped_column(Boolean)


class MetricScore(UuidPk, CreatedAt, Base):
    __tablename__ = "metric_scores"
    __table_args__ = (
        UniqueConstraint("run_case_id", "metric", "mode"),
        CheckConstraint(in_values("mode", values(MetricMode)), name="mode"),
        CheckConstraint(in_values("status", values(MetricStatus)), name="status"),
        Index("ix_metric_scores_metric_mode", "metric", "mode"),
    )

    run_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE")
    )
    metric: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text, server_default="chat")
    value: Mapped[float | None] = mapped_column(Float)
    passed: Mapped[bool | None] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(Text, server_default="ok")
    n_samples: Mapped[int] = mapped_column(Integer, server_default=sql_text("1"))
    spread: Mapped[float | None] = mapped_column(Float)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=EMPTY_JSON)
    judge_call_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), server_default=sql_text("'{}'::uuid[]")
    )


class Claim(UuidPk, CreatedAt, Base):
    __tablename__ = "claims"
    __table_args__ = (
        UniqueConstraint("run_case_id", "idx"),
        CheckConstraint(
            f"verdict IS NULL OR {in_values('verdict', values(ClaimVerdict))}", name="verdict"
        ),
    )

    run_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE")
    )
    idx: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    sentence_idx: Mapped[int | None] = mapped_column(Integer)
    citation_ns: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), server_default=sql_text("'{}'::integer[]")
    )
    verdict: Mapped[str | None] = mapped_column(Text)
    supporting_ns: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), server_default=sql_text("'{}'::integer[]")
    )
    evidence_quote: Mapped[str | None] = mapped_column(Text)
    reasoning: Mapped[str | None] = mapped_column(Text)


class JudgeCall(UuidPk, CreatedAt, Base):
    """One metered Anthropic call (E4). `request_hash` makes retries free."""

    __tablename__ = "judge_calls"
    __table_args__ = (
        CheckConstraint(in_values("status", values(JudgeCallStatus)), name="status"),
        Index("ix_judge_calls_run_id_created_at", "run_id", "created_at"),
    )

    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE")
    )
    run_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE"), index=True
    )
    # Synthetic generation (E7). SET NULL keeps the spend (month totals read judge_calls).
    batch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("synthetic_batches.id", ondelete="SET NULL"), index=True
    )
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("synthetic_candidates.id", ondelete="SET NULL"), index=True
    )
    purpose: Mapped[str] = mapped_column(Text)
    prompt_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_versions.id", ondelete="SET NULL")
    )
    model: Mapped[str] = mapped_column(Text)
    model_actual: Mapped[str | None] = mapped_column(Text)
    effort: Mapped[str | None] = mapped_column(Text)
    sample_idx: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    request_hash: Mapped[str] = mapped_column(Text, index=True)
    input_tokens: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    cache_write_tokens: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    output_tokens: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    cost_usd: Mapped[Decimal] = mapped_column(USD, server_default=ZERO)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    stop_reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default="ok")
    error: Mapped[str | None] = mapped_column(Text)
    response: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class RunAggregate(CreatedAt, Base):
    __tablename__ = "run_aggregates"
    __table_args__ = (
        PrimaryKeyConstraint("run_id", "metric", "mode", "slice"),
        CheckConstraint(in_values("mode", values(MetricMode)), name="mode"),
        CheckConstraint(
            f"ci_method IS NULL OR {in_values('ci_method', values(CiMethod))}", name="ci_method"
        ),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE")
    )
    metric: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text)
    slice: Mapped[str] = mapped_column(Text)  # all, type:*, dept:*, juris:*, tag:*, …
    n: Mapped[int] = mapped_column(Integer)
    mean: Mapped[float | None] = mapped_column(Float)
    ci_low: Mapped[float | None] = mapped_column(Float)
    ci_high: Mapped[float | None] = mapped_column(Float)
    ci_method: Mapped[str | None] = mapped_column(Text)
    pass_rate: Mapped[float | None] = mapped_column(Float)
    # Counts of na/error/refusal and, for latency metrics, p50/p95.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=EMPTY_JSON)
