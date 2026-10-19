"""eval hooks: conversations.is_eval/eval_run_id/eval_case_id, llm_usage eval tags

Revision ID: 0004_eval_hooks
Revises: 0003_request_logs
Create Date: 2026-10-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.core.config import get_settings

# The schema differs per environment (documind_dev locally, documind in prod): never hard-code it.
SCHEMA = get_settings().db_schema

# revision identifiers, used by Alembic.
revision: str = "0004_eval_hooks"
down_revision: str | Sequence[str] | None = "0003_request_logs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("is_eval", sa.Boolean(), server_default="false", nullable=False),
        schema=SCHEMA,
    )
    op.add_column("conversations", sa.Column("eval_run_id", sa.Text()), schema=SCHEMA)
    op.add_column("conversations", sa.Column("eval_case_id", sa.Text()), schema=SCHEMA)
    op.create_index(
        "ix_conversations_eval_run_id",
        "conversations",
        ["eval_run_id"],
        unique=False,
        schema=SCHEMA,
        postgresql_where=sa.text("eval_run_id IS NOT NULL"),
    )

    op.add_column("llm_usage", sa.Column("eval_run_id", sa.Text()), schema=SCHEMA)
    op.add_column("llm_usage", sa.Column("eval_case_id", sa.Text()), schema=SCHEMA)
    op.create_index(
        "ix_llm_usage_eval_run_id_created_at",
        "llm_usage",
        ["eval_run_id", "created_at"],
        unique=False,
        schema=SCHEMA,
        postgresql_where=sa.text("eval_run_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_llm_usage_eval_run_id_created_at", table_name="llm_usage", schema=SCHEMA)
    op.drop_column("llm_usage", "eval_case_id", schema=SCHEMA)
    op.drop_column("llm_usage", "eval_run_id", schema=SCHEMA)
    op.drop_index("ix_conversations_eval_run_id", table_name="conversations", schema=SCHEMA)
    op.drop_column("conversations", "eval_case_id", schema=SCHEMA)
    op.drop_column("conversations", "eval_run_id", schema=SCHEMA)
    op.drop_column("conversations", "is_eval", schema=SCHEMA)
