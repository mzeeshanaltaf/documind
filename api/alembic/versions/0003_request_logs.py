"""api request logs, llm_usage.request_id

Revision ID: 0003_request_logs
Revises: 0002_quotas_bookmarks
Create Date: 2026-10-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.config import get_settings

# The schema differs per environment (documind_dev locally, documind in prod): never hard-code it.
SCHEMA = get_settings().db_schema

# revision identifiers, used by Alembic.
revision: str = "0003_request_logs"
down_revision: str | Sequence[str] | None = "0002_quotas_bookmarks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_request_logs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("request_id", sa.Text(), nullable=True),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("query", sa.Text(), nullable=True),
        sa.Column("route", sa.Text(), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("org_id", sa.Text(), nullable=True),
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("client_ip", sa.Text(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("request_headers", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("request_body", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("request_body_size", sa.Integer(), nullable=True),
        sa.Column("response_headers", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("response_body", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("response_content_type", sa.Text(), nullable=True),
        sa.Column("response_body_size", sa.Integer(), nullable=True),
        sa.Column("body_truncated", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("error_traceback", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_api_request_logs")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_api_request_logs_created_at",
        "api_request_logs",
        [sa.literal_column("created_at DESC")],
        unique=False,
        schema=SCHEMA,
    )
    for columns in (
        ["status_code", "created_at"],
        ["route", "created_at"],
        ["user_id", "created_at"],
    ):
        op.create_index(
            op.f(f"ix_api_request_logs_{'_'.join(columns)}"),
            "api_request_logs",
            columns,
            unique=False,
            schema=SCHEMA,
        )
    op.create_index(
        op.f("ix_api_request_logs_request_id"),
        "api_request_logs",
        ["request_id"],
        unique=False,
        schema=SCHEMA,
    )

    op.add_column("llm_usage", sa.Column("request_id", sa.Text(), nullable=True), schema=SCHEMA)
    op.create_index(
        op.f("ix_llm_usage_request_id"), "llm_usage", ["request_id"], unique=False, schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_llm_usage_request_id"), table_name="llm_usage", schema=SCHEMA)
    op.drop_column("llm_usage", "request_id", schema=SCHEMA)
    op.drop_table("api_request_logs", schema=SCHEMA)
