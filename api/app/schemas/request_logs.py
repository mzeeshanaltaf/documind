import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LogItemOut(BaseModel):
    """A row of the logs list."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    request_id: str | None
    method: str
    path: str
    query: str | None
    route: str | None
    status_code: int
    duration_ms: int
    user_id: str | None
    user_email: str | None = None
    org_id: str | None
    org_slug: str | None = None
    error_code: str | None
    total_tokens: int = Field(0, description="Input + output tokens of the request's LLM calls.")
    cost_usd: float = 0


class LogListOut(BaseModel):
    items: list[LogItemOut]
    next_cursor: str | None = Field(description="Pass as `before` for the next (older) page.")
    total: int | None = Field(
        None, description="Rows matching the filters; only on a first page (no cursor)."
    )


class LogRoutesOut(BaseModel):
    routes: list[str]


class LlmCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    operation: str
    model: str
    service_tier_requested: str | None
    service_tier_actual: str | None
    input_tokens: int
    cached_tokens: int
    output_tokens: int
    reasoning_tokens: int
    latency_ms: int | None
    ttft_ms: int | None
    cost_usd: float
    pricing_estimated: bool
    status: str
    error: str | None


class LlmTotalsOut(BaseModel):
    calls: int = 0
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0


class LogUserOut(BaseModel):
    id: str
    name: str
    email: str


class LogOrgOut(BaseModel):
    id: str
    name: str
    slug: str


class LogMessageOut(BaseModel):
    """The assistant message a chat request produced."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    routing: Any | None
    retrieval: Any | None
    sources: Any | None
    citations: Any | None


class LogDetailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    request_id: str | None
    method: str
    path: str
    query: str | None
    route: str | None
    status_code: int
    duration_ms: int
    user_id: str | None
    org_id: str | None
    conversation_id: uuid.UUID | None
    message_id: uuid.UUID | None
    document_id: uuid.UUID | None
    client_ip: str | None
    user_agent: str | None
    request_headers: Any | None
    request_body: Any | None
    request_body_size: int | None
    response_headers: Any | None
    response_body: Any | None
    response_content_type: str | None
    response_body_size: int | None
    body_truncated: bool
    error_code: str | None
    error_message: str | None
    error_traceback: str | None
    user: LogUserOut | None = None
    org: LogOrgOut | None = None
    llm_calls: list[LlmCallOut] = []
    llm_totals: LlmTotalsOut = LlmTotalsOut()
    message: LogMessageOut | None = None
