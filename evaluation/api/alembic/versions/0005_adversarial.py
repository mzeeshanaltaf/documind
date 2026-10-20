"""adversarial: authz probe requests on cases

`cases.probes` lists an `authz_probe` case's requests (method, path with placeholders, body,
eval headers, expected status); null for every other case type.

Revision ID: 0005_adversarial
Revises: 0004_synthetic
Create Date: 2026-10-20 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.config import get_settings

SCHEMA = get_settings().db_schema

revision: str = "0005_adversarial"
down_revision: str | Sequence[str] | None = "0004_synthetic"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cases",
        sa.Column("probes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("cases", "probes", schema=SCHEMA)
