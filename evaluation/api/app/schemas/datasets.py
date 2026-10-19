import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import CaseSource, CaseType, DatasetKind, Difficulty, ExpectedBehavior

# Case keys end up in X-Request-ID (`eval.<run8>.<case_key>.<attempt>`) and in eval headers.
CASE_KEY_PATTERN = r"^[A-Za-z0-9_-]{1,80}$"
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}$"
MAX_SETUP_TURNS = 6


class KeyFact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fact: str = Field(min_length=1, max_length=2000)
    weight: float = Field(default=1.0, gt=0, le=10)


class CaseFields(BaseModel):
    """Every content field of a case: what's hashed, exported and imported."""

    model_config = ConfigDict(extra="forbid")

    case_key: str = Field(pattern=CASE_KEY_PATTERN)
    type: CaseType
    question: str = Field(min_length=1, max_length=4000)
    setup_turns: list[str] = Field(default_factory=list, max_length=MAX_SETUP_TURNS)
    reference_answer: str | None = None
    key_facts: list[KeyFact] = Field(default_factory=list)
    expected_doc_codes: list[str] = Field(default_factory=list)
    expected_sections: list[str] = Field(
        default_factory=list, description='"CODE §section", e.g. "SIM-HR-001 §3.1".'
    )
    expected_pages: Any | None = None
    expected_departments: list[str] = Field(default_factory=list)
    expected_jurisdiction: str | None = None
    expected_behavior: ExpectedBehavior = "answer"
    scope_doc_codes: list[str] = Field(default_factory=list)
    forbidden_doc_codes: list[str] = Field(default_factory=list)
    injection_canary: str | None = None
    expected_standalone_query: str | None = None
    tags: list[str] = Field(default_factory=list)
    difficulty: Difficulty | None = None
    source: CaseSource = "manual"
    notes: str | None = None

    @field_validator("question")
    @classmethod
    def _question(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question cannot be blank")
        return value.strip()


CONTENT_FIELDS: tuple[str, ...] = tuple(CaseFields.model_fields)


class CaseIn(CaseFields):
    """A new case; without `case_key` one is generated."""

    case_key: str | None = Field(default=None, pattern=CASE_KEY_PATTERN)  # type: ignore[assignment]


class CasePatch(BaseModel):
    """Only the fields sent are changed (null clears an optional field)."""

    model_config = ConfigDict(extra="forbid")

    case_key: str | None = Field(default=None, pattern=CASE_KEY_PATTERN)
    position: int | None = Field(default=None, ge=0)
    type: CaseType | None = None
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
    scope_doc_codes: list[str] | None = None
    forbidden_doc_codes: list[str] | None = None
    injection_canary: str | None = None
    expected_standalone_query: str | None = None
    tags: list[str] | None = None
    difficulty: Difficulty | None = None
    source: CaseSource | None = None
    notes: str | None = None


# Patch fields that may not be set to null (their columns are NOT NULL).
REQUIRED_PATCH_FIELDS = frozenset(
    {
        "case_key",
        "position",
        "type",
        "question",
        "setup_turns",
        "key_facts",
        "expected_doc_codes",
        "expected_sections",
        "expected_departments",
        "expected_behavior",
        "scope_doc_codes",
        "forbidden_doc_codes",
        "tags",
        "source",
    }
)


class CaseOut(CaseFields):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dataset_version_id: uuid.UUID
    position: int
    created_at: datetime
    updated_at: datetime


class CaseListOut(BaseModel):
    cases: list[CaseOut]
    total: int


class DatasetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(pattern=SLUG_PATTERN)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    default_org_slug: str | None = Field(default=None, max_length=100)
    kind: DatasetKind = "mixed"


class DatasetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    default_org_slug: str | None = Field(default=None, max_length=100)
    kind: DatasetKind | None = None
    archived: bool | None = None


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dataset_id: uuid.UUID
    version: int
    status: str
    case_count: int
    content_hash: str | None
    notes: str | None
    created_by: str | None
    created_at: datetime
    published_at: datetime | None
    published_by: str | None


class DatasetRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    default_org_slug: str | None


class VersionDetailOut(VersionOut):
    dataset: DatasetRef


class DatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    default_org_slug: str | None
    kind: str
    created_by: str | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    latest_version: VersionOut | None = None
    latest_published: VersionOut | None = None


class DatasetDetailOut(DatasetOut):
    versions: list[VersionOut]


class DatasetListOut(BaseModel):
    datasets: list[DatasetOut]


class NewVersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: str | None = Field(default=None, max_length=4000)


class ImportRowError(BaseModel):
    line: int
    message: str


class ImportOut(BaseModel):
    """`POST /v1/datasets/import`: with `preview=true` nothing is saved (`dataset`/`version`
    are then null)."""

    preview: bool
    cases: list[CaseFields]
    errors: list[ImportRowError]
    warnings: list[str]
    dataset: DatasetRef | None = None
    version: VersionOut | None = None
    unchanged: bool = Field(
        default=False, description="The content matched the latest published version (no-op)."
    )
