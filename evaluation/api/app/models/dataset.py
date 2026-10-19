import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UpdatedAt, UuidPk, in_values
from app.models.enums import (
    CaseSource,
    CaseType,
    DatasetKind,
    Difficulty,
    ExpectedBehavior,
    VersionStatus,
    values,
)

EMPTY_TEXT_ARRAY = text("'{}'::text[]")


class Dataset(UuidPk, CreatedAt, UpdatedAt, Base):
    __tablename__ = "datasets"
    __table_args__ = (CheckConstraint(in_values("kind", values(DatasetKind)), name="kind"),)

    slug: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    default_org_slug: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, server_default="mixed")
    created_by: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DatasetVersion(UuidPk, CreatedAt, Base):
    """A published version is immutable (its `content_hash` covers the cases); edits go into a
    draft copied from the latest version."""

    __tablename__ = "dataset_versions"
    __table_args__ = (
        UniqueConstraint("dataset_id", "version"),
        CheckConstraint(in_values("status", values(VersionStatus)), name="status"),
    )

    dataset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("datasets.id", ondelete="CASCADE")
    )
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, server_default="draft")
    case_count: Mapped[int] = mapped_column(Integer, server_default="0")
    content_hash: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[str | None] = mapped_column(Text)


class Case(UuidPk, CreatedAt, UpdatedAt, Base):
    __tablename__ = "cases"
    __table_args__ = (
        UniqueConstraint("dataset_version_id", "case_key"),
        CheckConstraint(in_values("type", values(CaseType)), name="type"),
        CheckConstraint(
            in_values("expected_behavior", values(ExpectedBehavior)), name="expected_behavior"
        ),
        CheckConstraint(
            f"difficulty IS NULL OR {in_values('difficulty', values(Difficulty))}",
            name="difficulty",
        ),
        CheckConstraint(in_values("source", values(CaseSource)), name="source"),
    )

    dataset_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dataset_versions.id", ondelete="CASCADE")
    )
    case_key: Mapped[str] = mapped_column(Text)  # stable across versions; pairs runs (E6)
    position: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
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
    scope_doc_codes: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)
    forbidden_doc_codes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=EMPTY_TEXT_ARRAY
    )
    injection_canary: Mapped[str | None] = mapped_column(Text)
    expected_standalone_query: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=EMPTY_TEXT_ARRAY)
    difficulty: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text, server_default="manual")
    notes: Mapped[str | None] = mapped_column(Text)
