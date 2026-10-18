"""user quotas, quota usage, message bookmarks

Revision ID: 0002_quotas_bookmarks
Revises: 0001_initial
Create Date: 2026-10-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.core.config import get_settings

# The schema differs per environment (documind_dev locally, documind in prod): never hard-code it.
SCHEMA = get_settings().db_schema

# revision identifiers, used by Alembic.
revision: str = "0002_quotas_bookmarks"
down_revision: str | Sequence[str] | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "quota_usage",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("messages", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tokens", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.user.id"],
            name=op.f("fk_quota_usage_user_id_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "period_start", name=op.f("pk_quota_usage")),
        schema=SCHEMA,
    )
    op.create_table(
        "user_quotas",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("message_limit", sa.Integer(), nullable=False),
        sa.Column("token_limit", sa.BigInteger(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.CheckConstraint("message_limit >= 0", name=op.f("ck_user_quotas_message_limit")),
        sa.CheckConstraint("token_limit >= 0", name=op.f("ck_user_quotas_token_limit")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.user.id"],
            name=op.f("fk_user_quotas_user_id_user"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_quotas")),
        schema=SCHEMA,
    )
    op.add_column(
        "messages",
        sa.Column("bookmarked_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_messages_bookmarked_at",
        "messages",
        ["bookmarked_at"],
        unique=False,
        schema=SCHEMA,
        postgresql_where=sa.text("bookmarked_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_messages_bookmarked_at",
        table_name="messages",
        schema=SCHEMA,
        postgresql_where=sa.text("bookmarked_at IS NOT NULL"),
    )
    op.drop_column("messages", "bookmarked_at", schema=SCHEMA)
    op.drop_table("user_quotas", schema=SCHEMA)
    op.drop_table("quota_usage", schema=SCHEMA)
