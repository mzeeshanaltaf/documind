"""The durable queue against the real (test-schema) Postgres."""

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.core.db import SessionLocal, session_scope
from app.worker import loop, queue
from app.worker.errors import PermanentJobError, RetryLater
from app.worker.handlers import HANDLERS

pytestmark = pytest.mark.db

W = "test-worker"


@pytest.fixture(autouse=True)
async def _clean() -> None:
    async with session_scope() as session:
        await session.execute(text("DELETE FROM jobs"))
        await session.execute(text("DELETE FROM runs"))
        await session.execute(text("DELETE FROM datasets"))


async def add_job(kind: str = "noop", **kwargs) -> uuid.UUID:
    async with session_scope() as session:
        return await queue.enqueue(session, kind, **kwargs)


async def job_row(job_id: uuid.UUID):  # noqa: ANN201
    async with SessionLocal() as session:
        return (
            await session.execute(
                text(
                    "SELECT status, attempts, locked_by, locked_at, last_error, "
                    "available_at > now() + interval '5 seconds' AS delayed "
                    "FROM jobs WHERE id = :id"
                ),
                {"id": job_id},
            )
        ).one()


async def add_run(status: str) -> uuid.UUID:
    """The smallest run a job can point at: dataset → version → run."""
    ids = {name: uuid.uuid4() for name in ("dataset", "version", "run")}
    async with session_scope() as session:
        await session.execute(
            text("INSERT INTO datasets (id, slug, name) VALUES (:dataset, :slug, 'Queue test')"),
            {**ids, "slug": f"q-{ids['dataset'].hex[:8]}"},
        )
        await session.execute(
            text(
                "INSERT INTO dataset_versions (id, dataset_id, version) "
                "VALUES (:version, :dataset, 1)"
            ),
            ids,
        )
        await session.execute(
            text(
                "INSERT INTO runs (id, dataset_version_id, org_id, org_slug, mode, status, "
                "config_hash) VALUES (:run, :version, 'org', 'simtora', 'full', :status, 'h')"
            ),
            {**ids, "status": status},
        )
    return ids["run"]


async def test_claim_takes_priority_then_age() -> None:
    old = await add_job()
    urgent = await add_job(priority=5)
    first, second = await queue.claim(W), await queue.claim(W)
    assert (first.id, second.id) == (urgent, old)
    assert first.attempts == 1 and first.kind == "noop" and first.worker_id == W
    assert await queue.claim(W) is None
    row = await job_row(urgent)
    assert (row.status, row.locked_by) == ("running", W)


async def test_claim_skips_locked_jobs() -> None:
    locked, free = await add_job(priority=1), await add_job()
    async with SessionLocal() as holder:
        # Another transaction holds the row lock (as a concurrent claim would).
        await holder.execute(text("SELECT id FROM jobs WHERE id = :id FOR UPDATE"), {"id": locked})
        claimed = await asyncio.wait_for(queue.claim(W), timeout=15)
        assert claimed is not None and claimed.id == free  # not blocked, not the locked one
        assert await queue.claim(W) is None
        await holder.rollback()
    assert (await queue.claim(W)).id == locked


async def test_delayed_job_waits() -> None:
    await add_job(delay=timedelta(minutes=1))
    assert await queue.claim(W) is None


async def test_expired_lock_is_reclaimed() -> None:
    stale, fresh = await add_job(), await add_job()
    async with session_scope() as session:
        await session.execute(
            text(
                "UPDATE jobs SET status = 'running', attempts = 1, locked_by = 'dead', "
                "locked_at = now() - CASE WHEN id = :stale THEN interval '6 minutes' "
                "ELSE interval '1 minute' END"
            ),
            {"stale": stale},
        )
    claimed = await queue.claim(W)
    assert claimed is not None and claimed.id == stale
    assert claimed.attempts == 2
    assert await queue.claim(W) is None  # the freshly locked one is still owned
    # The dead worker can no longer record an outcome.
    ghost = queue.ClaimedJob(
        id=stale, kind="noop", run_id=None, run_case_id=None, batch_id=None, worker_id="dead"
    )
    assert await queue.succeed(ghost) is False
    assert (await job_row(fresh)).locked_by == "dead"


async def test_release_restores_the_attempt() -> None:
    job_id = await add_job()
    job = await queue.claim(W)
    assert (await job_row(job_id)).attempts == 1
    assert await queue.release(job) is True
    row = await job_row(job_id)
    assert (row.status, row.attempts, row.locked_by, row.locked_at) == ("queued", 0, None, None)
    assert (await queue.claim(W)).attempts == 1


async def test_paused_run_is_not_claimed() -> None:
    run_id = await add_run("paused")
    case_job = await add_job("case_generate", run_id=run_id)
    assert await queue.claim(W) is None

    finalize = await add_job("run_finalize", run_id=run_id)  # finalize ignores the run status
    assert (await queue.claim(W)).id == finalize

    async with session_scope() as session:
        await session.execute(
            text("UPDATE runs SET status = 'running' WHERE id = :id"), {"id": run_id}
        )
    assert (await queue.claim(W)).id == case_job


async def test_one_live_finalize_per_run() -> None:
    from sqlalchemy.exc import IntegrityError

    run_id = await add_run("finalizing")
    await add_job("run_finalize", run_id=run_id)
    with pytest.raises(IntegrityError):
        await add_job("run_finalize", run_id=run_id)


async def test_fail_retries_with_backoff_then_fails() -> None:
    job_id = await add_job(max_attempts=2)
    job = await queue.claim(W)
    await queue.fail(job, "boom")
    row = await job_row(job_id)
    assert (row.status, row.attempts, row.last_error, row.delayed) == ("queued", 1, "boom", True)

    async with session_scope() as session:
        await session.execute(text("UPDATE jobs SET available_at = now()"))
    job = await queue.claim(W)
    assert job.attempts == 2
    await queue.fail(job, "boom again")
    assert (await job_row(job_id)).status == "failed"


async def test_requeue_does_not_spend_an_attempt() -> None:
    job_id = await add_job()
    await queue.requeue(await queue.claim(W), timedelta(seconds=30))
    row = await job_row(job_id)
    assert (row.status, row.attempts, row.delayed) == ("queued", 0, True)


def test_backoff_grows_and_caps() -> None:
    assert [queue.backoff(n).total_seconds() for n in (1, 2, 3)] == [10, 20, 40]
    assert queue.backoff(20) == queue.MAX_BACKOFF


async def test_process_records_each_outcome(monkeypatch: pytest.MonkeyPatch) -> None:
    ok = await add_job(payload={"sleep_s": 0})
    await loop.process(await queue.claim(W))
    assert (await job_row(ok)).status == "succeeded"

    err = await add_job(payload={"error": "kaput"})
    await loop.process(await queue.claim(W))
    row = await job_row(err)
    assert row.status == "queued" and row.last_error.startswith("RuntimeError: kaput")

    async def permanent(_job: queue.ClaimedJob) -> None:
        raise PermanentJobError("422 from DocuMind")

    async def rate_limited(_job: queue.ClaimedJob) -> None:
        raise RetryLater(timedelta(seconds=20))

    for handler, expected in ((permanent, ("failed", 1)), (rate_limited, ("queued", 0))):
        monkeypatch.setitem(HANDLERS, "noop", handler)
        job_id = await add_job(priority=10)
        await loop.process(await queue.claim(W))
        row = await job_row(job_id)
        assert (row.status, row.attempts) == expected


async def test_cancelled_slot_releases_its_job() -> None:
    job_id = await add_job(payload={"sleep_s": 30})
    stop = asyncio.Event()
    [slot] = loop.start_slots(1, stop)
    for _ in range(100):
        if (await job_row(job_id)).status == "running":
            break
        await asyncio.sleep(0.1)
    assert (await job_row(job_id)).status == "running"
    await loop.stop_slots([slot], stop)
    row = await job_row(job_id)
    assert (row.status, row.attempts, row.locked_by) == ("queued", 0, None)
