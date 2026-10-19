import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.rag.hybrid import Mode
from app.schemas.settings import Tier, known_chat_model

MAX_SCOPED_DOCUMENTS = 50
OVERRIDE_TOP_K_MIN, OVERRIDE_TOP_K_MAX = 1, 30


class ChatOverrides(BaseModel):
    """Per-request config for A/B experiments; only with eval headers (platform admins)."""

    model_config = ConfigDict(extra="forbid")

    top_k: int | None = Field(default=None, ge=OVERRIDE_TOP_K_MIN, le=OVERRIDE_TOP_K_MAX)
    retrieval_mode: Mode | None = None
    chat_model: str | None = None
    router_model: str | None = None
    chat_service_tier: Tier | None = None
    include_source_text: bool = Field(
        default=True, description="Send each source's chunk text in the eval `sources` event."
    )

    @field_validator("chat_model", "router_model")
    @classmethod
    def _known_model(cls, value: str | None) -> str | None:
        return known_chat_model(value)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=4000)
    document_ids: list[uuid.UUID] | None = Field(
        default=None,
        max_length=MAX_SCOPED_DOCUMENTS,
        description="Answer only from these documents (bypasses department routing).",
    )
    overrides: ChatOverrides | None = Field(
        default=None, description="Eval only (needs X-Eval-Run-Id): per-request config."
    )

    @field_validator("message")
    @classmethod
    def _message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message cannot be blank")
        return value.strip()

    @field_validator("document_ids")
    @classmethod
    def _document_ids(cls, value: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        return list(dict.fromkeys(value)) if value else None


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: str
    title: str | None
    scope: str
    document_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class ConversationListOut(BaseModel):
    conversations: list[ConversationOut]
    next_cursor: str | None = None


class MessageUsageOut(BaseModel):
    latency_ms: int | None
    ttft_ms: int | None
    cost_usd: float | None

    @classmethod
    def from_retrieval(cls, retrieval: dict[str, Any] | None) -> "MessageUsageOut | None":
        """Built from `messages.retrieval` (timings + usage totals saved with the answer)."""
        if not retrieval:
            return None
        timings = retrieval.get("timings_ms") or {}
        usage = retrieval.get("usage") or {}
        return cls(
            latency_ms=timings.get("total"),
            ttft_ms=timings.get("ttft"),
            cost_usd=usage.get("cost_usd"),
        )


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str
    content: str
    citations: list[dict[str, Any]] | None
    sources: list[dict[str, Any]] | None
    routing: dict[str, Any] | None
    status: str
    feedback: int | None
    feedback_comment: str | None
    bookmarked_at: datetime | None
    created_at: datetime
    usage: MessageUsageOut | None = Field(
        default=None, description="Answer latency and cost; platform admins only."
    )


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut]


class ConversationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("title cannot be blank")
        return value.strip()


class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: Literal[1, -1]
    comment: str | None = Field(default=None, max_length=2000)


class FeedbackOut(BaseModel):
    message_id: uuid.UUID
    feedback: int
    feedback_comment: str | None


class BookmarkOut(BaseModel):
    message_id: uuid.UUID
    bookmarked_at: datetime | None


class BookmarkItemOut(BaseModel):
    """A bookmarked answer with the question it answered, for the bookmarks list."""

    message_id: uuid.UUID
    conversation_id: uuid.UUID
    conversation_title: str | None
    question: str | None
    answer_excerpt: str
    doc_codes: list[str]
    bookmarked_at: datetime
    created_at: datetime


class BookmarkListOut(BaseModel):
    bookmarks: list[BookmarkItemOut]
