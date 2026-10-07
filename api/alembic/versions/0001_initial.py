"""initial app tables: documents, ingestion, chunks + BM25, chat, settings, usage

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

from app.core.config import get_settings

# The schema differs per environment (documind_dev locally, documind in prod): never hard-code it.
SCHEMA = get_settings().db_schema

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMBEDDING_DIM = 1536
EMPTY_ARRAY = sa.text("'{}'")
NOW = sa.text("now()")


def _ref(table: str) -> str:
    return f"{SCHEMA}.{table}.id"


def _id() -> sa.Column:
    return sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False)


def _ts(name: str, nullable: bool = False) -> sa.Column:
    default = None if nullable else NOW
    return sa.Column(name, sa.DateTime(timezone=True), server_default=default, nullable=nullable)


def upgrade() -> None:
    op.execute(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"')
    # `vector` is installed in `public` already; this is a no-op guard for fresh databases.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "documents",
        _id(),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("doc_code", sa.Text()),
        sa.Column("legal_entity", sa.Text()),
        sa.Column("department", sa.Text()),
        sa.Column("jurisdiction", sa.Text()),
        sa.Column("doc_type", sa.Text()),
        sa.Column("version", sa.Text()),
        sa.Column("effective_date", sa.Date()),
        sa.Column("review_cycle", sa.Text()),
        sa.Column("owner", sa.Text()),
        sa.Column("approved_by", sa.Text()),
        sa.Column("applies_to", sa.Text()),
        sa.Column(
            "related_doc_codes",
            postgresql.ARRAY(sa.Text()),
            server_default=EMPTY_ARRAY,
            nullable=False,
        ),
        sa.Column("summary", sa.Text()),
        sa.Column("outline", postgresql.JSONB()),
        sa.Column("page_count", sa.Integer()),
        sa.Column("file_key", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text()),
        sa.Column("file_size", sa.BigInteger()),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="uploaded", nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("uploaded_by", sa.Text()),
        _ts("created_at"),
        _ts("updated_at"),
        _ts("indexed_at", nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_documents"),
        sa.UniqueConstraint("org_id", "sha256", name="uq_documents_org_id_sha256"),
        sa.CheckConstraint(
            "status IN ('uploaded', 'processing', 'ready', 'failed')",
            name=op.f("ck_documents_status"),
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            [_ref("organization")],
            name="fk_documents_org_id_organization",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            [_ref("user")],
            name="fk_documents_uploaded_by_user",
            ondelete="SET NULL",
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_documents_org_id_status", "documents", ["org_id", "status"], schema=SCHEMA)
    op.create_index(
        "ix_documents_org_id_department", "documents", ["org_id", "department"], schema=SCHEMA
    )

    op.create_table(
        "ingestion_jobs",
        _id(),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default="queued", nullable=False),
        sa.Column("stage", sa.Text()),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", sa.Text()),
        _ts("locked_at", nullable=True),
        _ts("created_at"),
        _ts("started_at", nullable=True),
        _ts("finished_at", nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_ingestion_jobs"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')",
            name=op.f("ck_ingestion_jobs_status"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            [_ref("documents")],
            name="fk_ingestion_jobs_document_id_documents",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_ingestion_jobs_status_created_at",
        "ingestion_jobs",
        ["status", "created_at"],
        schema=SCHEMA,
    )

    op.create_table(
        "chunks",
        _id(),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embed_text", sa.Text(), nullable=False),
        sa.Column("section_path", postgresql.ARRAY(sa.Text())),
        sa.Column("section_number", sa.Text()),
        sa.Column("section_title", sa.Text()),
        sa.Column("page_start", sa.Integer()),
        sa.Column("page_end", sa.Integer()),
        sa.Column("content_type", sa.Text()),
        sa.Column("token_count", sa.Integer()),
        sa.Column(
            "cross_refs", postgresql.ARRAY(sa.Text()), server_default=EMPTY_ARRAY, nullable=False
        ),
        sa.Column("department", sa.Text()),
        sa.Column("jurisdiction", sa.Text()),
        sa.Column("doc_type", sa.Text()),
        sa.Column("embedding", Vector(EMBEDDING_DIM)),
        sa.Column("bm25_len", sa.Integer(), nullable=False),
        _ts("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_chunks"),
        sa.ForeignKeyConstraint(
            ["document_id"],
            [_ref("documents")],
            name="fk_chunks_document_id_documents",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chunks_org_id_document_id", "chunks", ["org_id", "document_id"], schema=SCHEMA
    )
    op.create_index(
        "ix_chunks_org_id_department", "chunks", ["org_id", "department"], schema=SCHEMA
    )
    op.create_index(
        "ix_chunks_embedding_hnsw",
        "chunks",
        ["embedding"],
        schema=SCHEMA,
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    op.create_table(
        "chunk_terms",
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("term", sa.Text(), nullable=False),
        sa.Column("chunk_id", sa.Uuid(), nullable=False),
        sa.Column("tf", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("org_id", "term", "chunk_id", name="pk_chunk_terms"),
        sa.ForeignKeyConstraint(
            ["chunk_id"],
            [_ref("chunks")],
            name="fk_chunk_terms_chunk_id_chunks",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_chunk_terms_chunk_id", "chunk_terms", ["chunk_id"], schema=SCHEMA)

    op.create_table(
        "bm25_stats",
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("n_chunks", sa.Integer(), nullable=False),
        sa.Column("avg_len", sa.Double(), nullable=False),
        _ts("updated_at"),
        sa.PrimaryKeyConstraint("org_id", name="pk_bm25_stats"),
        sa.ForeignKeyConstraint(
            ["org_id"],
            [_ref("organization")],
            name="fk_bm25_stats_org_id_organization",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "conversations",
        _id(),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text()),
        sa.Column("scope", sa.Text(), server_default="all", nullable=False),
        sa.Column(
            "document_ids", postgresql.ARRAY(sa.Uuid()), server_default=EMPTY_ARRAY, nullable=False
        ),
        _ts("created_at"),
        _ts("updated_at"),
        sa.PrimaryKeyConstraint("id", name="pk_conversations"),
        sa.CheckConstraint("scope IN ('all', 'docs')", name=op.f("ck_conversations_scope")),
        sa.ForeignKeyConstraint(
            ["org_id"],
            [_ref("organization")],
            name="fk_conversations_org_id_organization",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [_ref("user")],
            name="fk_conversations_user_id_user",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_conversations_org_id_user_id_updated_at",
        "conversations",
        ["org_id", "user_id", sa.text("updated_at DESC")],
        schema=SCHEMA,
    )

    op.create_table(
        "messages",
        _id(),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column("citations", postgresql.JSONB()),
        sa.Column("sources", postgresql.JSONB()),
        sa.Column("routing", postgresql.JSONB()),
        sa.Column("retrieval", postgresql.JSONB()),
        sa.Column("status", sa.Text(), server_default="complete", nullable=False),
        sa.Column("feedback", sa.SmallInteger()),
        sa.Column("feedback_comment", sa.Text()),
        _ts("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_messages"),
        sa.CheckConstraint("role IN ('user', 'assistant')", name=op.f("ck_messages_role")),
        sa.CheckConstraint(
            "status IN ('complete', 'error', 'stopped')", name=op.f("ck_messages_status")
        ),
        sa.CheckConstraint(
            "feedback IS NULL OR feedback IN (-1, 1)", name=op.f("ck_messages_feedback")
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            [_ref("conversations")],
            name="fk_messages_conversation_id_conversations",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_messages_conversation_id_created_at",
        "messages",
        ["conversation_id", "created_at"],
        schema=SCHEMA,
    )

    tiers = "('standard', 'flex', 'auto')"
    op.create_table(
        "org_settings",
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("chat_model", sa.Text()),
        sa.Column("router_model", sa.Text()),
        sa.Column("chat_service_tier", sa.Text()),
        sa.Column("background_service_tier", sa.Text()),
        sa.Column("top_k", sa.Integer(), server_default="8", nullable=False),
        _ts("updated_at"),
        sa.Column("updated_by", sa.Text()),
        sa.PrimaryKeyConstraint("org_id", name="pk_org_settings"),
        sa.CheckConstraint(
            f"chat_service_tier IS NULL OR chat_service_tier IN {tiers}",
            name=op.f("ck_org_settings_chat_service_tier"),
        ),
        sa.CheckConstraint(
            f"background_service_tier IS NULL OR background_service_tier IN {tiers}",
            name=op.f("ck_org_settings_background_service_tier"),
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            [_ref("organization")],
            name="fk_org_settings_org_id_organization",
            ondelete="CASCADE",
        ),
        schema=SCHEMA,
    )

    # No FKs on purpose: usage rows must survive deletions of orgs, users and documents.
    op.create_table(
        "llm_usage",
        _id(),
        sa.Column("org_id", sa.Text()),
        sa.Column("user_id", sa.Text()),
        sa.Column("conversation_id", sa.Uuid()),
        sa.Column("message_id", sa.Uuid()),
        sa.Column("document_id", sa.Uuid()),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("service_tier_requested", sa.Text()),
        sa.Column("service_tier_actual", sa.Text()),
        sa.Column("input_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("cached_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("reasoning_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("latency_ms", sa.Integer()),
        sa.Column("ttft_ms", sa.Integer()),
        sa.Column("cost_usd", sa.Numeric(14, 8), server_default="0", nullable=False),
        sa.Column("pricing_estimated", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("status", sa.Text(), server_default="ok", nullable=False),
        sa.Column("error", sa.Text()),
        _ts("created_at"),
        sa.PrimaryKeyConstraint("id", name="pk_llm_usage"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_llm_usage_org_id_created_at", "llm_usage", ["org_id", "created_at"], schema=SCHEMA
    )
    op.create_index(
        "ix_llm_usage_operation_created_at",
        "llm_usage",
        ["operation", "created_at"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    # Drop in reverse dependency order. The schema and the `vector` extension are shared
    # (Better Auth tables live in the same schema), so they are left in place.
    for table in (
        "llm_usage",
        "org_settings",
        "messages",
        "conversations",
        "bm25_stats",
        "chunk_terms",
        "chunks",
        "ingestion_jobs",
        "documents",
    ):
        op.drop_table(table, schema=SCHEMA)
