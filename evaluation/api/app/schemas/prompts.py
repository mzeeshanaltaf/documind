import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PromptVersionSummary(BaseModel):
    id: uuid.UUID
    version: int
    sha256: str
    model: str
    effort: str | None
    thinking: str | None
    params: dict[str, Any]
    created_at: datetime


class PromptVersionOut(PromptVersionSummary):
    body: str
    output_schema: dict[str, Any] | None


class PromptOut(BaseModel):
    key: str
    kind: str
    description: str | None
    versions: int
    latest: PromptVersionSummary | None
    current_version: int | None
    file_present: bool


class PromptDiffOut(BaseModel):
    key: str
    from_version: int
    to_version: int
    diff: str
