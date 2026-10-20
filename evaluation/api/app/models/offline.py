"""Offline judging: Anthropic calls parked as tasks that Claude Code answers (no API spend)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UuidPk, in_values

OFFLINE_STATUSES = ("pending", "fulfilled", "cancelled")


class OfflineTask(UuidPk, CreatedAt, Base):
    """One `judge.call()` that `EVAL_JUDGE_MODE=offline` parked instead of sending. Fulfilling it
    stores a `judge_calls` row with the same `request_hash`, which the job reuses on its next
    attempt. `owner_id` = the run case or synthetic candidate the call belongs to."""

    __tablename__ = "offline_tasks"
    __table_args__ = (
        UniqueConstraint("owner_id", "request_hash"),
        CheckConstraint(in_values("status", OFFLINE_STATUSES), name="status"),
        Index("ix_offline_tasks_status_created_at", "status", "created_at"),
    )

    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    request_hash: Mapped[str] = mapped_column(Text)
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    run_case_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    purpose: Mapped[str] = mapped_column(Text)
    prompt_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    model: Mapped[str] = mapped_column(Text)
    effort: Mapped[str | None] = mapped_column(Text)
    sample_idx: Mapped[int] = mapped_column(Integer)
    system: Mapped[str] = mapped_column(Text)
    packet: Mapped[str] = mapped_column(Text)
    task: Mapped[str] = mapped_column(Text)
    output_schema: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text, server_default="pending")
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
