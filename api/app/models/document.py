import uuid
from datetime import date

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    BigInteger,
    CheckConstraint,
    Date,
    Double,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import organization_table, user_table
from app.models.base import Base
from app.models.common import (
    EMPTY_ARRAY,
    CreatedAt,
    OptionalTimestamp,
    UpdatedAt,
    UuidPk,
    in_values,
)

# Must match the embedding model's output (text-embedding-3-small → 1536).
EMBEDDING_DIM = 1536

DOCUMENT_STATUSES = ("uploaded", "processing", "ready", "failed")
JOB_STATUSES = ("queued", "running", "succeeded", "failed")


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("org_id", "sha256"),
        Index(None, "org_id", "status"),
        Index(None, "org_id", "department"),
        CheckConstraint(in_values("status", DOCUMENT_STATUSES), name="status"),
    )

    id: Mapped[UuidPk]
    org_id: Mapped[str] = mapped_column(
        Text, ForeignKey(organization_table.c.id, ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    doc_code: Mapped[str | None] = mapped_column(Text)
    legal_entity: Mapped[str | None] = mapped_column(Text)
    department: Mapped[str | None] = mapped_column(Text)
    jurisdiction: Mapped[str | None] = mapped_column(Text)
    doc_type: Mapped[str | None] = mapped_column(Text)
    version: Mapped[str | None] = mapped_column(Text)
    effective_date: Mapped[date | None] = mapped_column(Date)
    review_cycle: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(Text)
    approved_by: Mapped[str | None] = mapped_column(Text)
    applies_to: Mapped[str | None] = mapped_column(Text)
    related_doc_codes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=EMPTY_ARRAY
    )
    summary: Mapped[str | None] = mapped_column(Text)
    outline: Mapped[list | dict | None] = mapped_column(JSONB)
    page_count: Mapped[int | None] = mapped_column(Integer)
    file_key: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str | None] = mapped_column(Text)
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="uploaded", server_default="uploaded"
    )
    error: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey(user_table.c.id, ondelete="SET NULL")
    )
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]
    indexed_at: Mapped[OptionalTimestamp]


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (
        Index(None, "status", "created_at"),
        CheckConstraint(in_values("status", JOB_STATUSES), name="status"),
    )

    id: Mapped[UuidPk]
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey(Document.id, ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="queued", server_default="queued"
    )
    stage: Mapped[str | None] = mapped_column(Text)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[OptionalTimestamp]
    created_at: Mapped[CreatedAt]
    started_at: Mapped[OptionalTimestamp]
    finished_at: Mapped[OptionalTimestamp]


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (
        Index(None, "org_id", "document_id"),
        Index(None, "org_id", "department"),
        Index(
            "ix_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[UuidPk]
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey(Document.id, ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # `text` is shown and highlighted; `embed_text` (header + text) is embedded and BM25-indexed.
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embed_text: Mapped[str] = mapped_column(Text, nullable=False)
    section_path: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    section_number: Mapped[str | None] = mapped_column(Text)
    section_title: Mapped[str | None] = mapped_column(Text)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    content_type: Mapped[str | None] = mapped_column(Text)
    token_count: Mapped[int | None] = mapped_column(Integer)
    cross_refs: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=EMPTY_ARRAY
    )
    # Denormalized from the document for filtering; keep in sync on metadata edits.
    department: Mapped[str | None] = mapped_column(Text)
    jurisdiction: Mapped[str | None] = mapped_column(Text)
    doc_type: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM))
    bm25_len: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[CreatedAt]


class ChunkTerm(Base):
    """Inverted index for BM25: one row per (term, chunk) with its term frequency."""

    __tablename__ = "chunk_terms"
    __table_args__ = (Index(None, "chunk_id"),)

    org_id: Mapped[str] = mapped_column(Text, primary_key=True)
    term: Mapped[str] = mapped_column(Text, primary_key=True)
    chunk_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey(Chunk.id, ondelete="CASCADE"), primary_key=True
    )
    tf: Mapped[int] = mapped_column(Integer, nullable=False)


class Bm25Stats(Base):
    __tablename__ = "bm25_stats"

    org_id: Mapped[str] = mapped_column(
        Text, ForeignKey(organization_table.c.id, ondelete="CASCADE"), primary_key=True
    )
    n_chunks: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_len: Mapped[float] = mapped_column(Double, nullable=False)
    updated_at: Mapped[UpdatedAt]


__all__ = [
    "EMBEDDING_DIM",
    "Bm25Stats",
    "Chunk",
    "ChunkTerm",
    "Document",
    "IngestionJob",
]
