"""The durable job queue: the `jobs` table, claimed with `FOR UPDATE OF j SKIP LOCKED`.

A claimed job is `running` and locked by one worker slot, which heartbeats it every minute. A
crashed process stops heartbeating, so after `RECLAIM_AFTER` another slot reclaims the job. Jobs
of a run are only claimed while the run is active (running, stopping, finalizing), except its
`run_finalize`. A paused run's jobs therefore wait in place.

Every write after the claim is guarded by `locked_by`, so a slot whose lock was reclaimed can't
overwrite the new owner's outcome.
"""

import json
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import anyio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope

RECLAIM_AFTER = timedelta(minutes=5)
HEARTBEAT_EVERY_S = 60
MAX_BACKOFF = timedelta(minutes=5)
# asyncpg infers a parameter's type from context (`now() + $1` would be a timestamp), so
# interval parameters are cast explicitly and passed as `timedelta`.
LATER = "now() + CAST(:delay AS interval)"


@dataclass(frozen=True)
class ClaimedJob:
    id: uuid.UUID
    kind: str
    run_id: uuid.UUID | None
    run_case_id: uuid.UUID | None
    batch_id: uuid.UUID | None
    payload: dict[str, Any] = field(default_factory=dict)
    attempts: int = 1
    max_attempts: int = 3
    worker_id: str = ""


CLAIM_SQL = text(
    """
    UPDATE jobs SET status = 'running', locked_at = now(), locked_by = :w,
                    attempts = attempts + 1, updated_at = now()
    WHERE id = (
        SELECT j.id FROM jobs j LEFT JOIN runs r ON r.id = j.run_id
        WHERE ((j.status = 'queued' AND j.available_at <= now())
               OR (j.status = 'running' AND j.locked_at < now() - CAST(:reclaim AS interval)))
          AND (j.run_id IS NULL OR r.status IN ('running', 'stopping', 'finalizing')
               OR j.kind = 'run_finalize')
        ORDER BY j.priority DESC, j.created_at
        -- OF j: Postgres rejects FOR UPDATE on the nullable side of an outer join.
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
    )
    RETURNING id, kind, run_id, run_case_id, batch_id, payload, attempts, max_attempts
    """
)


async def enqueue(
    session: AsyncSession,
    kind: str,
    *,
    run_id: uuid.UUID | None = None,
    run_case_id: uuid.UUID | None = None,
    batch_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
    priority: int = 0,
    max_attempts: int = 3,
    delay: timedelta = timedelta(0),
) -> uuid.UUID:
    """Add a job inside the caller's transaction (so it exists only if the caller commits)."""
    job_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO jobs (id, kind, run_id, run_case_id, batch_id, payload, priority,
                              max_attempts, available_at)
            VALUES (:id, :kind, :run_id, :run_case_id, :batch_id, CAST(:payload AS jsonb),
                    :priority, :max_attempts, now() + CAST(:delay AS interval))
            """
        ),
        {
            "id": job_id,
            "kind": kind,
            "run_id": run_id,
            "run_case_id": run_case_id,
            "batch_id": batch_id,
            "payload": json.dumps(payload or {}, default=str),
            "priority": priority,
            "max_attempts": max_attempts,
            "delay": delay,
        },
    )
    return job_id


async def claim(worker_id: str) -> ClaimedJob | None:
    async with session_scope() as session:
        row = (
            await session.execute(CLAIM_SQL, {"w": worker_id, "reclaim": RECLAIM_AFTER})
        ).one_or_none()
    if row is None:
        return None
    return ClaimedJob(**row._asdict(), worker_id=worker_id)


async def _locked_update(job: ClaimedJob, set_sql: str, params: dict[str, Any]) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            text(
                f"UPDATE jobs SET {set_sql}, updated_at = now() "
                "WHERE id = :id AND locked_by = :w AND status = 'running'"
            ),
            {"id": job.id, "w": job.worker_id, **params},
        )
    return result.rowcount == 1  # type: ignore[attr-defined]


async def heartbeat(job: ClaimedJob) -> bool:
    """Refresh the lock; False means another slot reclaimed the job."""
    return await _locked_update(job, "locked_at = now()", {})


async def succeed(job: ClaimedJob) -> bool:
    return await _locked_update(
        job, "status = 'succeeded', finished_at = now(), locked_at = NULL, last_error = NULL", {}
    )


def backoff(attempts: int) -> timedelta:
    """10 s, 20 s, 40 s, … capped at 5 minutes."""
    return min(timedelta(seconds=10 * 2 ** max(attempts - 1, 0)), MAX_BACKOFF)


async def fail(job: ClaimedJob, error: str, *, retry: bool = True) -> bool:
    """Retry with backoff until `max_attempts`, then (or with `retry=False`) mark it failed."""
    if retry and job.attempts < job.max_attempts:
        return await _locked_update(
            job,
            f"status = 'queued', available_at = {LATER}, locked_at = NULL, "
            "locked_by = NULL, last_error = :error",
            {"delay": backoff(job.attempts), "error": error[:4000]},
        )
    return await _locked_update(
        job,
        "status = 'failed', finished_at = now(), locked_at = NULL, last_error = :error",
        {"error": error[:4000]},
    )


async def requeue(job: ClaimedJob, delay: timedelta) -> bool:
    """Put it back for later without spending an attempt (rate limits)."""
    return await _locked_update(
        job,
        f"status = 'queued', attempts = attempts - 1, available_at = {LATER}, "
        "locked_at = NULL, locked_by = NULL",
        {"delay": delay},
    )


async def release(job: ClaimedJob) -> bool:
    """Shutdown: hand the job back at once, attempt refunded. Shielded, because it runs while
    the slot task is being cancelled."""
    with anyio.CancelScope(shield=True):
        return await _locked_update(
            job,
            "status = 'queued', attempts = attempts - 1, locked_at = NULL, locked_by = NULL",
            {},
        )
