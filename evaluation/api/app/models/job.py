import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UpdatedAt, UuidPk, in_values
from app.models.enums import JobKind, JobStatus, values


class Job(UuidPk, CreatedAt, UpdatedAt, Base):
    """The durable work queue (`app/worker/queue.py`). A crashed worker's job is reclaimed once
    its lock is older than the reclaim window."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(in_values("kind", values(JobKind)), name="kind"),
        CheckConstraint(in_values("status", values(JobStatus)), name="status"),
        Index("ix_jobs_status_available_at_priority", "status", "available_at", "priority"),
        # One live finalize per run: concurrent last cases can't enqueue it twice.
        Index(
            "uq_jobs_run_finalize_active",
            "run_id",
            unique=True,
            postgresql_where=text("kind = 'run_finalize' AND status IN ('queued', 'running')"),
        ),
    )

    kind: Mapped[str] = mapped_column(Text)
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), index=True
    )
    run_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("run_cases.id", ondelete="CASCADE")
    )
    batch_id: Mapped[uuid.UUID | None] = mapped_column(  # synthetic (E7)
        UUID(as_uuid=True), ForeignKey("synthetic_batches.id", ondelete="CASCADE"), index=True
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(Text, server_default="queued")
    priority: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    max_attempts: Mapped[int] = mapped_column(Integer, server_default=text("3"))
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
