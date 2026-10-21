"""Human review & judge calibration (E9): review queues over one run's cases, the reviewers'
grades, and the judge-vs-human agreement per metric × prompt version × judge model."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UpdatedAt, UuidPk, in_values
from app.models.dataset import EMPTY_TEXT_ARRAY
from app.models.enums import CalibrationStatus, ReviewItemStatus, ReviewSampling, values


class ReviewQueue(UuidPk, CreatedAt, Base):
    """A sample of one run's cases to grade on `metrics`. `blind` hides the judge's scores from a
    reviewer until they have submitted their own for the item."""

    __tablename__ = "review_queues"
    __table_args__ = (
        CheckConstraint(in_values("sampling", values(ReviewSampling)), name="sampling"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(Text)
    metrics: Mapped[list[str]] = mapped_column(ARRAY(Text))
    sampling: Mapped[str] = mapped_column(Text, server_default="stratified")
    seed: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    size: Mapped[int] = mapped_column(Integer)  # requested; the items can be fewer
    blind: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # Sampling stats: eligible cases, the judge-score bucket of every item.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    created_by: Mapped[str | None] = mapped_column(Text)


class ReviewItem(UuidPk, CreatedAt, UpdatedAt, Base):
    """One run case in a queue. `status` is `done` once any reviewer graded every metric,
    `skipped` when it was only skipped; `skipped_by` keeps each reviewer's own skips."""

    __tablename__ = "review_items"
    __table_args__ = (
        UniqueConstraint("queue_id", "position"),
        UniqueConstraint("queue_id", "run_case_id"),
        CheckConstraint(in_values("status", values(ReviewItemStatus)), name="status"),
    )

    queue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("review_queues.id", ondelete="CASCADE")
    )
    run_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    skipped_by: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)


class Review(UuidPk, CreatedAt, UpdatedAt, Base):
    """One reviewer's grade of one metric on one run case (whichever queue it came from).
    `value` is on the metric's own scale (as in `metric_scores.value`), `label` the category
    picked (`"4"`, `"pass"`, a behaviour class); faithfulness keeps per-claim `claim_verdicts`
    (`{"1": "supported", …}`)."""

    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("run_case_id", "metric", "reviewer_id"),
        Index("ix_reviews_metric", "metric"),
    )

    run_case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE"), index=True
    )
    metric: Mapped[str] = mapped_column(Text)
    reviewer_id: Mapped[str] = mapped_column(Text)
    value: Mapped[float | None] = mapped_column(Float)
    label: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    claim_verdicts: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class Calibration(UuidPk, CreatedAt, Base):
    """Judge-vs-human agreement for one metric × prompt version × judge model, recomputed from
    every review by the `calibration_compute` job. `confusion` = `{labels, matrix}` (judge rows,
    human columns); `details` holds the scatter pairs, the human-human pairs and the test-retest
    spread."""

    __tablename__ = "calibrations"
    __table_args__ = (
        UniqueConstraint("metric", "prompt_version_id", "judge_model"),
        CheckConstraint(in_values("status", values(CalibrationStatus)), name="status"),
    )

    metric: Mapped[str] = mapped_column(Text)
    prompt_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompt_versions.id", ondelete="CASCADE")
    )
    judge_model: Mapped[str] = mapped_column(Text)
    n: Mapped[int] = mapped_column(Integer)
    kappa: Mapped[float | None] = mapped_column(Float)
    kappa_weighted: Mapped[float | None] = mapped_column(Float)
    spearman: Mapped[float | None] = mapped_column(Float)
    exact_pct: Mapped[float | None] = mapped_column(Float)
    within1_pct: Mapped[float | None] = mapped_column(Float)
    mae: Mapped[float | None] = mapped_column(Float)
    bias: Mapped[float | None] = mapped_column(Float)
    human_kappa: Mapped[float | None] = mapped_column(Float)
    confusion: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(Text)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
