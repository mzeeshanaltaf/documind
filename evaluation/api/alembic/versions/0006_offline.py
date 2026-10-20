"""offline: parked judge calls answered by Claude Code (no API spend)

Revision ID: 0006_offline
Revises: 0005_adversarial
Create Date: 2026-10-20 15:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.config import get_settings

SCHEMA = get_settings().db_schema

revision: str = "0006_offline"
down_revision: str | Sequence[str] | None = "0005_adversarial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "offline_tasks",
        sa.Column("owner_id", sa.UUID(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=True),
        sa.Column("run_case_id", sa.UUID(), nullable=True),
        sa.Column("batch_id", sa.UUID(), nullable=True),
        sa.Column("candidate_id", sa.UUID(), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("prompt_version_id", sa.UUID(), nullable=True),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("effort", sa.Text(), nullable=True),
        sa.Column("sample_idx", sa.Integer(), nullable=False),
        sa.Column("system", sa.Text(), nullable=False),
        sa.Column("packet", sa.Text(), nullable=False),
        sa.Column("task", sa.Text(), nullable=False),
        sa.Column("output_schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'fulfilled', 'cancelled')", name=op.f("ck_offline_tasks_status")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_offline_tasks")),
        sa.UniqueConstraint("owner_id", "request_hash", name=op.f("uq_offline_tasks_owner_id_request_hash")),
        schema=SCHEMA,
    )
    op.create_index(
        op.f("ix_offline_tasks_run_id"), "offline_tasks", ["run_id"], unique=False, schema=SCHEMA
    )
    op.create_index(
        op.f("ix_offline_tasks_batch_id"), "offline_tasks", ["batch_id"], unique=False, schema=SCHEMA
    )
    op.create_index(
        "ix_offline_tasks_status_created_at",
        "offline_tasks",
        ["status", "created_at"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("offline_tasks", schema=SCHEMA)
