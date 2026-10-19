"""judge: numbered prompt versions, source titles/owners on retrieved contexts

`prompt_versions.version` numbers a prompt's versions (1, 2, …). The judge renders sources
exactly like DocuMind (`[n] CODE · title · §…`), so contexts keep the document title (and its
owner, for the behaviour judge's context).

Revision ID: 0003_judge
Revises: 0002_usd_precision
Create Date: 2026-10-19 16:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.core.config import get_settings

SCHEMA = get_settings().db_schema

revision: str = "0003_judge"
down_revision: str | Sequence[str] | None = "0002_usd_precision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "prompt_versions",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        schema=SCHEMA,
    )
    op.alter_column("prompt_versions", "version", server_default=None, schema=SCHEMA)
    op.create_unique_constraint(
        op.f("uq_prompt_versions_prompt_id_version"),
        "prompt_versions",
        ["prompt_id", "version"],
        schema=SCHEMA,
    )
    op.add_column("retrieved_contexts", sa.Column("title", sa.Text(), nullable=True), schema=SCHEMA)
    op.add_column("retrieved_contexts", sa.Column("owner", sa.Text(), nullable=True), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("retrieved_contexts", "owner", schema=SCHEMA)
    op.drop_column("retrieved_contexts", "title", schema=SCHEMA)
    op.drop_constraint(
        op.f("uq_prompt_versions_prompt_id_version"), "prompt_versions", schema=SCHEMA
    )
    op.drop_column("prompt_versions", "version", schema=SCHEMA)
