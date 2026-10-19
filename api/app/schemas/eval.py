import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.rag.hybrid import Mode
from app.schemas.chat import MAX_SCOPED_DOCUMENTS, OVERRIDE_TOP_K_MAX, OVERRIDE_TOP_K_MIN
from app.schemas.settings import Tier, known_chat_model

MAX_HISTORY = 6


class HistoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)


class RetrieveRequest(BaseModel):
    """Retrieval without an answer: route once, embed once, then retrieve per mode."""

    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=4000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=MAX_HISTORY)
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=MAX_SCOPED_DOCUMENTS)
    modes: list[Mode] = Field(default_factory=lambda: ["hybrid"], min_length=1, max_length=3)
    top_k: int | None = Field(default=None, ge=OVERRIDE_TOP_K_MIN, le=OVERRIDE_TOP_K_MAX)
    router_model: str | None = None
    chat_service_tier: Tier | None = None

    @field_validator("query")
    @classmethod
    def _query(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("query cannot be blank")
        return value.strip()

    @field_validator("document_ids")
    @classmethod
    def _document_ids(cls, value: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        return list(dict.fromkeys(value)) if value else None

    @field_validator("modes")
    @classmethod
    def _modes(cls, value: list[Mode]) -> list[Mode]:
        if len(set(value)) != len(value):
            raise ValueError("modes must be unique")
        return value

    @field_validator("router_model")
    @classmethod
    def _known_model(cls, value: str | None) -> str | None:
        return known_chat_model(value)
