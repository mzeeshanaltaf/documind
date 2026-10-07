import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_SCOPED_DOCUMENTS = 50


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=4000)
    document_ids: list[uuid.UUID] | None = Field(
        default=None,
        max_length=MAX_SCOPED_DOCUMENTS,
        description="Answer only from these documents (bypasses department routing).",
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
    created_at: datetime


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
