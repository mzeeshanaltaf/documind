"""DocuMind's chat SSE events (`api/app/services/chat.py::run_chat`), eval-mode supersets.

Order: meta → routing → sources → delta… → citations → usage → done, or `error` at any point
after meta. A clarification turn sends `sources: []` and the question as a single delta.
"""

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.documind.models import Citation, OperationUsage, RetrievalSummary, Routing, Source


class _Event(BaseModel):
    model_config = ConfigDict(extra="allow")


class MetaEvent(_Event):
    event: Literal["meta"] = "meta"
    conversation_id: str
    user_message_id: str
    assistant_message_id: str


class RoutingEvent(_Event):
    event: Literal["routing"] = "routing"
    routing: Routing


class SourcesEvent(_Event):
    event: Literal["sources"] = "sources"
    sources: list[Source] = Field(default_factory=list)


class DeltaEvent(_Event):
    event: Literal["delta"] = "delta"
    text: str


class CitationsEvent(_Event):
    event: Literal["citations"] = "citations"
    citations: list[Citation] = Field(default_factory=list)


class UsageEvent(_Event):
    event: Literal["usage"] = "usage"
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int | None = None
    ttft_ms: int | None = None
    by_operation: list[OperationUsage] = Field(default_factory=list)  # eval only
    retrieval: RetrievalSummary | None = None  # eval only; None on a clarification turn


class DoneEvent(_Event):
    event: Literal["done"] = "done"


class ErrorEvent(_Event):
    event: Literal["error"] = "error"
    message: str = "Something went wrong."


ChatEvent = (
    MetaEvent
    | RoutingEvent
    | SourcesEvent
    | DeltaEvent
    | CitationsEvent
    | UsageEvent
    | DoneEvent
    | ErrorEvent
)


class UnknownEventError(ValueError):
    pass


def parse_event(name: str, data: str | Any) -> ChatEvent:
    """One SSE frame → a typed event. `data` is the raw JSON string (or already decoded)."""
    payload = json.loads(data) if isinstance(data, str) else data
    match name:
        case "meta":
            return MetaEvent.model_validate(payload)
        case "routing":
            return RoutingEvent.model_validate({"routing": payload})
        case "sources":
            return SourcesEvent.model_validate({"sources": payload})
        case "delta":
            return DeltaEvent.model_validate(payload)
        case "citations":
            return CitationsEvent.model_validate({"citations": payload})
        case "usage":
            return UsageEvent.model_validate(payload)
        case "done":
            return DoneEvent()
        case "error":
            return ErrorEvent.model_validate(payload or {})
    raise UnknownEventError(f"Unknown DocuMind SSE event {name!r}")
