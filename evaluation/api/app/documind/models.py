"""Shapes DocuMind returns (eval-mode supersets from E1). Unknown keys are kept (`extra="allow"`),
so a newer DocuMind never breaks parsing and traces stay complete."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["bm25", "vector", "hybrid"]


class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")


class SourceScores(_Open):
    bm25_rank: int | None = None
    vector_rank: int | None = None
    rrf: float | None = None
    score: float | None = None
    added_as: str | None = None  # "table_fragment" when pulled in beside a chosen table chunk
    part: int | None = None


class Source(_Open):
    """`Source.as_dict()` in DocuMind's `rag/hybrid.py`. `text` is absent when the chat override
    `include_source_text` is off."""

    n: int
    chunk_id: str
    document_id: str
    doc_code: str | None = None
    title: str = ""
    section_path: list[str] = Field(default_factory=list)
    section_number: str | None = None
    section_title: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    content_type: str | None = None
    text: str | None = None
    jurisdiction: str | None = None
    department: str | None = None
    owner: str | None = None
    scores: SourceScores = Field(default_factory=SourceScores)


class Citation(_Open):
    """`agents/citations.py::citation`: one per `[n]` marker that matches a source."""

    n: int
    document_id: str
    chunk_id: str | None = None
    doc_code: str | None = None
    title: str = ""
    section_number: str | None = None
    section_title: str | None = None
    section_path: list[str] = Field(default_factory=list)
    page_start: int | None = None
    page_end: int | None = None
    snippet: str | None = None
    highlight_text: str | None = None


class QueryPart(_Open):
    query: str
    departments: list[str] = Field(default_factory=list)
    jurisdiction: str | None = None


class Routing(_Open):
    """Eval mode: `Route.as_dict()` + `document_ids` (adds clarification and each part's query
    over the user payload)."""

    departments: list[str] = Field(default_factory=list)
    jurisdiction: str | None = None
    standalone_query: str = ""
    parts: list[QueryPart] = Field(default_factory=list)
    needs_clarification: bool = False
    clarifying_question: str | None = None
    bypassed: bool = False
    sub_queries: list[str] = Field(default_factory=list)
    document_ids: list[str] = Field(default_factory=list)


class OperationUsage(_Open):
    """One metered DocuMind call (`usage_by_operation`)."""

    operation: str
    model: str | None = None
    tier_requested: str | None = None
    tier_actual: str | None = None
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int | None = None
    ttft_ms: int | None = None


class RetrievalSummary(_Open):
    """`RetrievalResult.summary()`: lists, candidate count, per-source scores, timings."""

    lists: list[dict[str, Any]] = Field(default_factory=list)
    candidates: int = 0
    sources: list[dict[str, Any]] = Field(default_factory=list)
    timings_ms: dict[str, int] = Field(default_factory=dict)


class ModeResult(_Open):
    sources: list[Source] = Field(default_factory=list)
    retrieval: RetrievalSummary = Field(default_factory=RetrievalSummary)


class RetrieveUsage(_Open):
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    by_operation: list[OperationUsage] = Field(default_factory=list)


class RetrieveResult(_Open):
    """`POST /v1/orgs/{org_id}/retrieve`."""

    routing: Routing
    queries: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    results: dict[Mode, ModeResult] = Field(default_factory=dict)
    usage: RetrieveUsage = Field(default_factory=RetrieveUsage)
    timings_ms: dict[str, int] = Field(default_factory=dict)


class OrgAccess(_Open):
    id: str
    name: str
    slug: str
    role: str | None = None


class MeUser(_Open):
    id: str
    email: str
    name: str
    is_admin: bool


class Me(_Open):
    user: MeUser
    orgs: list[OrgAccess] = Field(default_factory=list)


class Document(_Open):
    """A row of `GET /v1/orgs/{org_id}/documents` (only what the harness reads is typed)."""

    id: str
    title: str
    doc_code: str | None = None
    department: str | None = None
    jurisdiction: str | None = None
    doc_type: str | None = None
    owner: str | None = None
    page_count: int | None = None
    status: str | None = None
    indexed_at: str | None = None


class ChunkPage(_Open):
    """`GET /v1/orgs/{org_id}/documents/{document_id}/chunks`."""

    document: dict[str, Any]
    total: int
    offset: int = 0
    limit: int = 0
    chunks: list[dict[str, Any]] = Field(default_factory=list)


class Health(_Open):
    status: str
    db: str | None = None
    version: str | None = None
