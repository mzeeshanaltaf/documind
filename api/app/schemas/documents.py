import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.ingestion.header import DOC_CODE_RE
from app.ingestion.metadata import DEPARTMENTS, DOC_TYPES, normalize_jurisdiction


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    stage: str | None
    progress: int
    attempts: int
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    doc_code: str | None
    legal_entity: str | None
    department: str | None
    jurisdiction: str | None
    doc_type: str | None
    version: str | None
    effective_date: date | None
    review_cycle: str | None
    owner: str | None
    approved_by: str | None
    applies_to: str | None
    related_doc_codes: list[str]
    page_count: int | None
    file_name: str | None
    file_size: int | None
    status: str
    error: str | None
    uploaded_by: str | None
    created_at: datetime
    updated_at: datetime
    indexed_at: datetime | None
    chunk_count: int = 0
    job: JobOut | None = None  # the latest ingestion job


class DocumentDetailOut(DocumentOut):
    summary: str | None
    outline: list[dict[str, Any]] | None


class DocumentListOut(BaseModel):
    documents: list[DocumentOut]


class DocumentPatchOut(DocumentDetailOut):
    needs_reindex: bool = Field(
        description="A field used in the chunks' contextual header changed; reindex to apply it."
    )


class DocumentPatch(BaseModel):
    """Editable metadata. Omitted fields stay as they are; null clears a field."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=300)
    doc_code: str | None = Field(default=None, max_length=40)
    legal_entity: str | None = Field(default=None, max_length=300)
    department: Literal[DEPARTMENTS] | None = None  # type: ignore[valid-type]
    jurisdiction: str | None = Field(
        default=None, description="ISO-3166 alpha-2 (GB, not UK) or GLOBAL."
    )
    doc_type: Literal[DOC_TYPES] | None = None  # type: ignore[valid-type]
    version: str | None = Field(default=None, max_length=40)
    effective_date: date | None = None
    review_cycle: str | None = Field(default=None, max_length=500)
    owner: str | None = Field(default=None, max_length=300)
    approved_by: str | None = Field(default=None, max_length=300)
    applies_to: str | None = Field(default=None, max_length=2000)
    related_doc_codes: list[str] | None = None
    summary: str | None = Field(default=None, max_length=4000)

    @field_validator("title")
    @classmethod
    def _title_not_null(cls, value: str | None) -> str:
        if value is None or not value.strip():
            raise ValueError("title cannot be empty")
        return value.strip()

    @field_validator("jurisdiction")
    @classmethod
    def _jurisdiction(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = normalize_jurisdiction(value)
        if code is None:
            raise ValueError("use an ISO-3166 alpha-2 code (e.g. DE, GB) or GLOBAL")
        return code

    @field_validator("related_doc_codes")
    @classmethod
    def _codes(cls, value: list[str] | None) -> list[str]:
        codes = [code.strip().upper() for code in value or [] if code.strip()]
        bad = [code for code in codes if not DOC_CODE_RE.fullmatch(code)]
        if bad:
            raise ValueError(f"invalid document codes: {', '.join(bad)}")
        return list(dict.fromkeys(codes))


UploadStatus = Literal["queued", "duplicate", "not_pdf", "too_large", "empty"]


class UploadItemOut(BaseModel):
    file_name: str
    status: UploadStatus
    document_id: uuid.UUID | None = None  # the new document, or the existing duplicate
    job_id: uuid.UUID | None = None
    message: str | None = None


class UploadOut(BaseModel):
    documents: list[UploadItemOut]
