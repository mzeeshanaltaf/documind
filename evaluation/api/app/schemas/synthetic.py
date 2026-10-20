import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import BatchKind, ExpectedBehavior, SyntheticType
from app.schemas.datasets import MAX_SETUP_TURNS, DatasetRef, KeyFact, VersionOut

MAX_PER_TYPE = 100
MAX_CANDIDATES = 200
GENERATOR_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5")
VALIDATOR_MODELS = ("claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5")


class BatchIn(BaseModel):
    """`kind=synthetic`: generate new cases from the org's chunks (`type_counts`, optional
    `document_ids` subset, `seed`). `kind=enrichment`: reference answers and key facts for the
    cases of `dataset_version_id`. Without `max_cost_usd` the cap is 2× the estimate."""

    model_config = ConfigDict(extra="forbid")

    kind: BatchKind = "synthetic"
    name: str | None = Field(default=None, max_length=200)
    org_slug: str | None = Field(default=None, max_length=100)
    target_dataset_id: uuid.UUID | None = None
    document_ids: list[str] = Field(default_factory=list, max_length=200)
    type_counts: dict[SyntheticType, int] = Field(default_factory=dict)
    generator_model: str | None = None
    validator_model: str | None = None
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    max_cost_usd: Decimal | None = Field(default=None, gt=0, le=100)
    dataset_version_id: uuid.UUID | None = None
    only_missing: bool = True

    @model_validator(mode="after")
    def _check(self) -> "BatchIn":
        if self.generator_model and self.generator_model not in GENERATOR_MODELS:
            raise ValueError(f"generator_model must be one of {', '.join(GENERATOR_MODELS)}")
        if self.validator_model and self.validator_model not in VALIDATOR_MODELS:
            raise ValueError(f"validator_model must be one of {', '.join(VALIDATOR_MODELS)}")
        if self.kind == "enrichment":
            if self.dataset_version_id is None:
                raise ValueError("an enrichment batch needs dataset_version_id")
            return self
        if any(n < 0 or n > MAX_PER_TYPE for n in self.type_counts.values()):
            raise ValueError(f"each type count must be between 0 and {MAX_PER_TYPE}")
        total = sum(self.type_counts.values())
        if not 1 <= total <= MAX_CANDIDATES:
            raise ValueError(f"ask for 1 to {MAX_CANDIDATES} candidates in total")
        return self


class ResumeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_cost_usd: Decimal | None = Field(default=None, gt=0, le=100)


class CommitIn(BaseModel):
    """Target dataset (default: the batch's). Approved, uncommitted candidates go into its draft
    version (an existing draft, else a new one copied from the latest version)."""

    model_config = ConfigDict(extra="forbid")

    dataset_id: uuid.UUID | None = None


class RejectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=500)


class CandidatePatch(BaseModel):
    """Only the fields sent change; any change marks the candidate `edited`."""

    model_config = ConfigDict(extra="forbid")

    question: str | None = Field(default=None, min_length=1, max_length=4000)
    setup_turns: list[str] | None = Field(default=None, max_length=MAX_SETUP_TURNS)
    reference_answer: str | None = None
    key_facts: list[KeyFact] | None = None
    expected_doc_codes: list[str] | None = None
    expected_sections: list[str] | None = None
    expected_pages: Any | None = None
    expected_departments: list[str] | None = None
    expected_jurisdiction: str | None = None
    expected_behavior: ExpectedBehavior | None = None


# Patch fields whose columns are NOT NULL.
REQUIRED_CANDIDATE_FIELDS = frozenset(
    {
        "question",
        "setup_turns",
        "key_facts",
        "expected_doc_codes",
        "expected_sections",
        "expected_departments",
        "expected_behavior",
    }
)


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    batch_id: uuid.UUID
    ordinal: int
    type: str
    gen_status: str
    status: str
    seed: dict[str, Any]
    question: str | None
    setup_turns: list[str]
    reference_answer: str | None
    key_facts: list[dict[str, Any]]
    expected_doc_codes: list[str]
    expected_sections: list[str]
    expected_pages: Any | None
    expected_departments: list[str]
    expected_jurisdiction: str | None
    expected_behavior: str
    source_chunk_ids: list[str]
    source_excerpt: list[dict[str, Any]]
    evidence_quotes: list[str]
    rationale: str | None
    checks: dict[str, Any]
    auto_rejected: bool
    reject_reason: str | None
    edited: bool
    target_case_key: str | None
    error: str | None
    cost_usd: float
    reviewer_id: str | None
    reviewed_at: datetime | None
    case_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CandidateListOut(BaseModel):
    candidates: list[CandidateOut]
    total: int


class BatchCounts(BaseModel):
    total: int = 0
    queued: int = 0
    pending: int = 0
    approved: int = 0
    rejected: int = 0
    auto_rejected: int = 0
    committed: int = 0


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    kind: str
    org_id: str
    org_slug: str
    target_dataset_id: uuid.UUID | None
    target_dataset: DatasetRef | None = None
    source_version_id: uuid.UUID | None
    config: dict[str, Any]
    status: str
    status_reason: str | None
    prompt_version_ids: dict[str, Any]
    cost_usd: float
    max_cost_usd: float | None
    estimate_usd: float = 0.0
    candidate_count: int
    generated_count: int
    failed_count: int
    counts: BatchCounts = Field(default_factory=BatchCounts)
    by_type: dict[str, BatchCounts] = Field(default_factory=dict)
    created_by: str | None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None
    committed_at: datetime | None
    committed_version_id: uuid.UUID | None


class BatchListOut(BaseModel):
    batches: list[BatchOut]


class CommitSkip(BaseModel):
    candidate_id: uuid.UUID
    reason: str


class CommitOut(BaseModel):
    dataset: DatasetRef
    version: VersionOut
    added: int
    updated: int
    skipped: list[CommitSkip]
