"""Synthetic test sets (E7): generation batches and the candidates awaiting human review."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UpdatedAt, UuidPk, in_values
from app.models.dataset import EMPTY_TEXT_ARRAY
from app.models.enums import (
    BatchKind,
    BatchStatus,
    CandidateGenStatus,
    CandidateStatus,
    CaseType,
    ExpectedBehavior,
    values,
)
from app.models.run import USD, ZERO


class SyntheticBatch(UuidPk, CreatedAt, UpdatedAt, Base):
    """`kind=synthetic`: new cases generated from sampled chunks. `kind=enrichment`: reference
    answers and key facts for the cases of `source_version_id`. Its candidates are seeded at
    creation; one `synthetic_generate` job fills each. `cost_usd` = Σ its `judge_calls`; reaching
    `max_cost_usd` pauses the batch (`status_reason = budget`)."""

    __tablename__ = "synthetic_batches"
    __table_args__ = (
        CheckConstraint(in_values("kind", values(BatchKind)), name="kind"),
        CheckConstraint(in_values("status", values(BatchStatus)), name="status"),
    )

    name: Mapped[str | None] = mapped_column(Text)
    org_id: Mapped[str] = mapped_column(Text)
    org_slug: Mapped[str] = mapped_column(Text)
    target_dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="SET NULL")
    )
    # Enrichment: the version whose cases get references.
    source_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dataset_versions.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(Text)
    # Document ids, type counts, generator/validator model, seed, sampling stats.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(Text, server_default="generating")
    status_reason: Mapped[str | None] = mapped_column(Text)
    # `{key: {version_id, sha256, version}}` of the gen.* prompts, recorded at creation.
    prompt_version_ids: Mapped[dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    cost_usd: Mapped[Decimal] = mapped_column(USD, server_default=ZERO)
    max_cost_usd: Mapped[Decimal | None] = mapped_column(USD)
    candidate_count: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    generated_count: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    failed_count: Mapped[int] = mapped_column(Integer, server_default=ZERO)
    created_by: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    committed_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dataset_versions.id", ondelete="SET NULL")
    )


class SyntheticCandidate(UuidPk, CreatedAt, UpdatedAt, Base):
    """A proposed case. `gen_status` tracks generation, `status` the human review; a candidate
    failing a hard check is auto-`rejected` (`auto_rejected`, `reject_reason`) and can still be
    restored. `checks` = deterministic checks + the validator's verdict."""

    __tablename__ = "synthetic_candidates"
    __table_args__ = (
        UniqueConstraint("batch_id", "ordinal"),
        CheckConstraint(in_values("type", values(CaseType)), name="type"),
        CheckConstraint(in_values("status", values(CandidateStatus)), name="status"),
        CheckConstraint(in_values("gen_status", values(CandidateGenStatus)), name="gen_status"),
        CheckConstraint(
            in_values("expected_behavior", values(ExpectedBehavior)), name="expected_behavior"
        ),
        Index("ix_synthetic_candidates_batch_id_status", "batch_id", "status"),
    )

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("synthetic_batches.id", ondelete="CASCADE")
    )
    ordinal: Mapped[int] = mapped_column(Integer)  # 1, 2, … → case key syn-<batch8>-NNN
    type: Mapped[str] = mapped_column(Text)
    gen_status: Mapped[str] = mapped_column(Text, server_default="queued")
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    # The sampling seed: chunk refs and hints (jurisdictions, theme) the generator gets.
    seed: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    question: Mapped[str | None] = mapped_column(Text)
    setup_turns: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)
    reference_answer: Mapped[str | None] = mapped_column(Text)
    key_facts: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    expected_doc_codes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=EMPTY_TEXT_ARRAY
    )
    expected_sections: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=EMPTY_TEXT_ARRAY
    )
    expected_pages: Mapped[Any | None] = mapped_column(JSONB)
    expected_departments: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=EMPTY_TEXT_ARRAY
    )
    expected_jurisdiction: Mapped[str | None] = mapped_column(Text)
    expected_behavior: Mapped[str] = mapped_column(Text, server_default="answer")
    source_chunk_ids: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=EMPTY_TEXT_ARRAY
    )
    # The seed chunks as shown to the generator (code, section, pages, text).
    source_excerpt: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    # Verbatim quotes the generator says carry the answer (highlighted in review).
    evidence_quotes: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)
    rationale: Mapped[str | None] = mapped_column(Text)
    checks: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    auto_rejected: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    reject_reason: Mapped[str | None] = mapped_column(Text)
    edited: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    target_case_key: Mapped[str | None] = mapped_column(Text)  # enrichment
    error: Mapped[str | None] = mapped_column(Text)
    cost_usd: Mapped[Decimal] = mapped_column(USD, server_default=ZERO)
    reviewer_id: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cases.id", ondelete="SET NULL")
    )
