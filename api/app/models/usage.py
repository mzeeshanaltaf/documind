import uuid
from decimal import Decimal

from sqlalchemy import Boolean, Index, Integer, Numeric, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.common import CreatedAt, UuidPk

USAGE_OPERATIONS = (
    "router",
    "answer",
    "embed_query",
    "embed_ingest",
    "classify",
    "summarize",
    "title",
)


class LlmUsage(Base):
    """One row per OpenAI call. No FKs on purpose: analytics must survive deletions."""

    __tablename__ = "llm_usage"
    __table_args__ = (
        Index(None, "org_id", "created_at"),
        Index(None, "operation", "created_at"),
    )

    id: Mapped[UuidPk]
    org_id: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[str | None] = mapped_column(Text)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    message_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    document_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    service_tier_requested: Mapped[str | None] = mapped_column(Text)
    service_tier_actual: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    cached_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    reasoning_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    ttft_ms: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(14, 8), nullable=False, default=Decimal(0), server_default="0"
    )
    pricing_estimated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, default="ok", server_default="ok")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[CreatedAt]
