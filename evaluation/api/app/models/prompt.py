import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, UpdatedAt, UuidPk, in_values
from app.models.enums import PromptKind, values


class Prompt(UuidPk, CreatedAt, Base):
    """A judge or generator prompt (`app/judge/prompts/<key>.md`, E4)."""

    __tablename__ = "prompts"
    __table_args__ = (CheckConstraint(in_values("kind", values(PromptKind)), name="kind"),)

    key: Mapped[str] = mapped_column(Text, unique=True)
    kind: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)


class PromptVersion(UuidPk, CreatedAt, Base):
    """One distinct prompt file content; synced at startup, recorded per run."""

    __tablename__ = "prompt_versions"

    prompt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prompts.id", ondelete="CASCADE"), index=True
    )
    sha256: Mapped[str] = mapped_column(Text, unique=True)
    body: Mapped[str] = mapped_column(Text)
    output_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(Text)
    effort: Mapped[str | None] = mapped_column(Text)
    thinking: Mapped[str | None] = mapped_column(Text)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))


class ConfigPreset(UuidPk, CreatedAt, UpdatedAt, Base):
    """A named run config (the `POST /v1/runs` body minus dataset and org)."""

    __tablename__ = "config_presets"

    name: Mapped[str] = mapped_column(Text, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    created_by: Mapped[str | None] = mapped_column(Text)
