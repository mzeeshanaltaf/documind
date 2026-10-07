from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import organization_table
from app.models.base import Base
from app.models.common import UpdatedAt

# Settings-level tier names; the OpenAI API calls `standard` "default".
SERVICE_TIERS = ("standard", "flex", "auto")


def _tier_check(column: str) -> CheckConstraint:
    values = ", ".join(f"'{tier}'" for tier in SERVICE_TIERS)
    return CheckConstraint(f"{column} IS NULL OR {column} IN ({values})", name=column)


class OrgSettings(Base):
    """Per-org overrides; NULL model/tier columns fall back to the env defaults."""

    __tablename__ = "org_settings"
    __table_args__ = (
        _tier_check("chat_service_tier"),
        _tier_check("background_service_tier"),
    )

    org_id: Mapped[str] = mapped_column(
        Text, ForeignKey(organization_table.c.id, ondelete="CASCADE"), primary_key=True
    )
    chat_model: Mapped[str | None] = mapped_column(Text)
    router_model: Mapped[str | None] = mapped_column(Text)
    chat_service_tier: Mapped[str | None] = mapped_column(Text)
    background_service_tier: Mapped[str | None] = mapped_column(Text)
    top_k: Mapped[int] = mapped_column(Integer, nullable=False, default=8, server_default="8")
    updated_at: Mapped[UpdatedAt]
    updated_by: Mapped[str | None] = mapped_column(Text)
