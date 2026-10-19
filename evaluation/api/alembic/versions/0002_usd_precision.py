"""usd columns at DocuMind's precision (numeric 14,8)

DocuMind meters `llm_usage.cost_usd` as numeric(14, 8); at 6 decimals a case's cost lost
digits (an embedding call is ~$0.0000004) and reconciliation drifted.

Revision ID: 0002_usd_precision
Revises: 0001_core
Create Date: 2026-10-19 11:10:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.core.config import get_settings

SCHEMA = get_settings().db_schema

revision: str = "0002_usd_precision"
down_revision: str | Sequence[str] | None = "0001_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = {
    "runs": (
        "documind_cost_usd",
        "documind_cost_reported_usd",
        "judge_cost_usd",
        "max_judge_cost_usd",
    ),
    "run_cases": ("documind_cost_usd", "judge_cost_usd"),
    "judge_calls": ("cost_usd",),
}


def _alter(scale: int) -> None:
    for table, columns in COLUMNS.items():
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.Numeric(precision=14, scale=scale),
                existing_type=sa.Numeric(precision=14, scale=8 if scale == 6 else 6),
                schema=SCHEMA,
            )


def upgrade() -> None:
    _alter(8)


def downgrade() -> None:
    _alter(6)
