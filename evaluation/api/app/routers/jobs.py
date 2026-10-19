"""Queue diagnostics: a job's state, and a `noop` job for the restart drill."""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import ApiError
from app.core.security import AdminDep, SessionDep
from app.models import Job
from app.worker import queue

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    run_id: uuid.UUID | None
    run_case_id: uuid.UUID | None
    status: str
    priority: int
    attempts: int
    max_attempts: int
    available_at: datetime
    locked_at: datetime | None
    locked_by: str | None
    last_error: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class NoopIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sleep_s: float = Field(default=0, ge=0, le=600)
    error: str | None = Field(default=None, max_length=500)
    max_attempts: int = Field(default=3, ge=1, le=10)


@router.post("/noop", status_code=status.HTTP_201_CREATED)
async def enqueue_noop(_: AdminDep, session: SessionDep, body: NoopIn) -> JobOut:
    job_id = await queue.enqueue(
        session,
        "noop",
        payload=body.model_dump(exclude={"max_attempts"}, exclude_none=True),
        max_attempts=body.max_attempts,
    )
    await session.commit()
    return JobOut.model_validate(await session.get(Job, job_id))


@router.get("/{job_id}")
async def get_job(_: AdminDep, session: SessionDep, job_id: uuid.UUID) -> JobOut:
    job = await session.get(Job, job_id)
    if job is None:
        raise ApiError(404, "not_found", "Job not found.")
    return JobOut.model_validate(job)
