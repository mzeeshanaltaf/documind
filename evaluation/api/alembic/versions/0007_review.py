"""review: human review queues, reviews and judge calibrations (E9)

Revision ID: 0007_review
Revises: 0006_offline
Create Date: 2026-10-21 10:23:45

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.core.config import get_settings

SCHEMA = get_settings().db_schema

revision: str = "0007_review"
down_revision: str | Sequence[str] | None = "0006_offline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMPTY_JSON = sa.text("'{}'::jsonb")
NOW = sa.text("now()")


def _id_created() -> list[sa.Column]:
    return [
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "calibrations",
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("prompt_version_id", sa.UUID(), nullable=False),
        sa.Column("judge_model", sa.Text(), nullable=False),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("kappa", sa.Float(), nullable=True),
        sa.Column("kappa_weighted", sa.Float(), nullable=True),
        sa.Column("spearman", sa.Float(), nullable=True),
        sa.Column("exact_pct", sa.Float(), nullable=True),
        sa.Column("within1_pct", sa.Float(), nullable=True),
        sa.Column("mae", sa.Float(), nullable=True),
        sa.Column("bias", sa.Float(), nullable=True),
        sa.Column("human_kappa", sa.Float(), nullable=True),
        sa.Column("confusion", postgresql.JSONB(astext_type=sa.Text()), server_default=EMPTY_JSON,
                  nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), server_default=EMPTY_JSON,
                  nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        *_id_created(),
        sa.CheckConstraint(
            "status IN ('uncalibrated', 'unreliable', 'moderate', 'calibrated')",
            name=op.f("ck_calibrations_status"),
        ),
        sa.ForeignKeyConstraint(
            ["prompt_version_id"], [f"{SCHEMA}.prompt_versions.id"],
            name=op.f("fk_calibrations_prompt_version_id_prompt_versions"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_calibrations")),
        sa.UniqueConstraint(
            "metric", "prompt_version_id", "judge_model",
            name=op.f("uq_calibrations_metric_prompt_version_id_judge_model"),
        ),
        schema=SCHEMA,
    )  # fmt: skip
    op.create_table(
        "review_queues",
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("metrics", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("sampling", sa.Text(), server_default="stratified", nullable=False),
        sa.Column("seed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("blind", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), server_default=EMPTY_JSON,
                  nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        *_id_created(),
        sa.CheckConstraint(
            "sampling IN ('stratified', 'random', 'disagreement')",
            name=op.f("ck_review_queues_sampling"),
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], [f"{SCHEMA}.runs.id"], name=op.f("fk_review_queues_run_id_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_queues")),
        schema=SCHEMA,
    )  # fmt: skip
    op.create_index(
        op.f("ix_review_queues_run_id"), "review_queues", ["run_id"], unique=False, schema=SCHEMA
    )
    op.create_table(
        "review_items",
        sa.Column("queue_id", sa.UUID(), nullable=False),
        sa.Column("run_case_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), server_default="pending", nullable=False),
        sa.Column("skipped_by", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"),
                  nullable=False),
        *_id_created(),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'done', 'skipped')", name=op.f("ck_review_items_status")
        ),
        sa.ForeignKeyConstraint(
            ["queue_id"], [f"{SCHEMA}.review_queues.id"],
            name=op.f("fk_review_items_queue_id_review_queues"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["run_case_id"], [f"{SCHEMA}.run_cases.id"],
            name=op.f("fk_review_items_run_case_id_run_cases"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_items")),
        sa.UniqueConstraint("queue_id", "position", name=op.f("uq_review_items_queue_id_position")),
        sa.UniqueConstraint(
            "queue_id", "run_case_id", name=op.f("uq_review_items_queue_id_run_case_id")
        ),
        schema=SCHEMA,
    )  # fmt: skip
    op.create_index(
        op.f("ix_review_items_run_case_id"), "review_items", ["run_case_id"], unique=False,
        schema=SCHEMA,
    )  # fmt: skip
    op.create_table(
        "reviews",
        sa.Column("run_case_id", sa.UUID(), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("reviewer_id", sa.Text(), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("claim_verdicts", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        *_id_created(),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(
            ["run_case_id"], [f"{SCHEMA}.run_cases.id"],
            name=op.f("fk_reviews_run_case_id_run_cases"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reviews")),
        sa.UniqueConstraint(
            "run_case_id", "metric", "reviewer_id",
            name=op.f("uq_reviews_run_case_id_metric_reviewer_id"),
        ),
        schema=SCHEMA,
    )  # fmt: skip
    op.create_index("ix_reviews_metric", "reviews", ["metric"], unique=False, schema=SCHEMA)
    op.create_index(
        op.f("ix_reviews_run_case_id"), "reviews", ["run_case_id"], unique=False, schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_table("reviews", schema=SCHEMA)
    op.drop_table("review_items", schema=SCHEMA)
    op.drop_table("review_queues", schema=SCHEMA)
    op.drop_table("calibrations", schema=SCHEMA)
