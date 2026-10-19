"""A run's state machine: case counting, settling (pausing → paused, all done / stopping →
finalizing), the pause/resume/stop controls and the periodic sweep.

    running ─pause→ pausing ─(nothing in flight)→ paused ─resume→ running
    running|pausing|paused ─stop→ stopping ─(nothing in flight)→ finalizing (partial)
    running|pausing ─(every case finished)→ finalizing → completed | stopped | failed

Every transition happens with the run row locked (`SELECT … FOR UPDATE`, or the counting
`UPDATE … RETURNING`), so concurrent case completions, controls and the sweeper serialize on it.
"In flight" means a case in `generating`/`judging` whose job is running with a live lock; a case
whose worker died doesn't hold up pause or stop (it is reclaimed on resume, or reset at
finalize).
"""

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.core.errors import ApiError
from app.models import Run, RunCase
from app.worker import queue

logger = logging.getLogger(__name__)

ACTIVE = frozenset({"running", "pausing", "paused", "stopping", "finalizing"})
TERMINAL = frozenset({"completed", "stopped", "failed"})
CASE_TERMINAL = frozenset({"done", "error", "skipped"})
CASE_IN_FLIGHT = ("generating", "judging")

IN_FLIGHT_SQL = text(
    """
    SELECT count(*) FROM run_cases rc
    WHERE rc.run_id = :run AND rc.status IN ('generating', 'judging')
      AND EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.run_id = :run AND j.run_case_id = rc.id AND j.status = 'running'
          AND j.locked_at > now() - CAST(:reclaim AS interval)
      )
    """
)


async def lock_run(
    session: AsyncSession, run_id: uuid.UUID, *, skip_locked: bool = False
) -> Run | None:
    stmt = (
        select(Run)
        .where(Run.id == run_id)
        .with_for_update(skip_locked=skip_locked)
        .execution_options(populate_existing=True)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def in_flight(session: AsyncSession, run_id: uuid.UUID) -> int:
    params = {"run": run_id, "reclaim": queue.RECLAIM_AFTER}
    return int((await session.execute(IN_FLIGHT_SQL, params)).scalar_one())


def all_finished(run: Run) -> bool:
    return run.done_cases + run.failed_cases + run.skipped_cases >= run.total_cases


async def _start_finalize(session: AsyncSession, run: Run, *, partial: bool) -> None:
    run.status = "finalizing"
    run.partial = partial
    await session.flush()
    await queue.enqueue_finalize(session, run.id)


async def settle(session: AsyncSession, run: Run) -> None:
    """Advance a locked run if its cases allow it. Idempotent; safe to call any time."""
    if run.status in ("running", "pausing") and all_finished(run):
        await _start_finalize(session, run, partial=False)
    elif run.status == "pausing" and await in_flight(session, run.id) == 0:
        run.status = "paused"
        await session.flush()
    elif run.status == "stopping" and await in_flight(session, run.id) == 0:
        await _start_finalize(session, run, partial=not all_finished(run))


async def count_case(
    session: AsyncSession,
    run_id: uuid.UUID,
    *,
    outcome: str,
    passed: bool | None = None,
    cost_usd: Decimal | float | None = None,
) -> Run:
    """Count one finished case atomically (the UPDATE locks the run row until commit), then
    settle. The caller has already moved the case to a terminal status in this transaction."""
    counter = {"done": Run.done_cases, "error": Run.failed_cases, "skipped": Run.skipped_cases}
    column = counter[outcome]
    values = {
        column.key: column + 1,
        "passed_cases": Run.passed_cases + (1 if passed else 0),
        "documind_cost_usd": Run.documind_cost_usd + Decimal(str(cost_usd or 0)),
        "updated_at": func.now(),
    }
    stmt = (
        update(Run)
        .where(Run.id == run_id)
        .values(**values)
        .returning(Run)
        .execution_options(populate_existing=True)
    )
    run = (await session.execute(stmt)).scalar_one()
    await settle(session, run)
    return run


async def fail_case(run_case_id: uuid.UUID, stage: str, message: str) -> bool:
    """Move a case to `error` and count it (once: a case already terminal is left alone)."""
    async with session_scope() as session:
        run_id = (
            await session.execute(
                update(RunCase)
                .where(RunCase.id == run_case_id, RunCase.status.notin_(CASE_TERMINAL))
                .values(status="error", error_stage=stage, error=message[:4000], passed=None)
                .returning(RunCase.run_id)
                .execution_options(synchronize_session=False)
            )
        ).scalar_one_or_none()
        if run_id is None:
            return False
        await count_case(session, run_id, outcome="error")
    logger.warning("Case %s failed at %s: %s", run_case_id, stage, message[:300])
    return True


# --- controls --------------------------------------------------------------------------------


async def _locked_or_404(session: AsyncSession, run_id: uuid.UUID) -> Run:
    run = await lock_run(session, run_id)
    if run is None:
        raise ApiError(404, "not_found", "Run not found.")
    return run


def _invalid(run: Run, action: str) -> ApiError:
    return ApiError(
        409,
        "invalid_transition",
        f"Can't {action} a run that is {run.status}.",
        {"status": run.status},
    )


async def pause(session: AsyncSession, run_id: uuid.UUID) -> Run:
    run = await _locked_or_404(session, run_id)
    if run.status != "running":
        raise _invalid(run, "pause")
    run.status = "pausing"
    await session.flush()
    await settle(session, run)
    return run


def over_budget(run: Run) -> bool:
    return run.max_judge_cost_usd is not None and run.judge_cost_usd >= run.max_judge_cost_usd


async def pause_for(session: AsyncSession, run_id: uuid.UUID, reason: str) -> Run | None:
    """The run pauses itself: `budget` (the judge spent `max_judge_cost_usd`) or
    `judge_unavailable` (Anthropic refuses every call: key, permission, spend limit)."""
    run = await lock_run(session, run_id)
    if run is None or run.status != "running":
        return run
    run.status = "pausing"
    run.status_reason = reason
    await session.flush()
    await settle(session, run)
    logger.warning("Run %s pauses: %s (judge cost $%s)", run_id, reason, run.judge_cost_usd)
    return run


async def pause_for_budget(session: AsyncSession, run_id: uuid.UUID) -> Run | None:
    return await pause_for(session, run_id, "budget")


async def resume(
    session: AsyncSession, run_id: uuid.UUID, max_judge_cost_usd: Decimal | None = None
) -> Run:
    """Resume a paused run, optionally with a new judge budget. A run still over its budget
    can't resume (it would pause again on its next judge call)."""
    run = await _locked_or_404(session, run_id)
    if run.status not in ("pausing", "paused"):
        raise _invalid(run, "resume")
    if max_judge_cost_usd is not None:
        run.max_judge_cost_usd = max_judge_cost_usd
    if over_budget(run):
        raise ApiError(
            409,
            "budget_exhausted",
            "The run has spent its judge budget; resume it with a higher max_judge_cost_usd.",
            {"judge_cost_usd": float(run.judge_cost_usd),
             "max_judge_cost_usd": float(run.max_judge_cost_usd or 0)},
        )  # fmt: skip
    run.status = "running"
    run.status_reason = None
    await session.flush()
    await settle(session, run)
    return run


async def stop(session: AsyncSession, run_id: uuid.UUID) -> Run:
    """Queued case jobs are cancelled; in-flight ones finish; then finalize (partial)."""
    run = await _locked_or_404(session, run_id)
    if run.status not in ("running", "pausing", "paused"):
        raise _invalid(run, "stop")
    run.status = "stopping"
    await session.flush()
    await session.execute(
        text(
            "UPDATE jobs SET status = 'cancelled', finished_at = now(), updated_at = now() "
            "WHERE run_id = :run AND status = 'queued' AND kind <> 'run_finalize'"
        ),
        {"run": run.id},
    )
    await settle(session, run)
    return run


# --- sweep -----------------------------------------------------------------------------------

ORPHANS_SQL = text(
    """
    SELECT rc.id, (
        SELECT j.last_error FROM jobs j
        WHERE j.run_id = rc.run_id AND j.run_case_id = rc.id AND j.status = 'failed'
        ORDER BY j.finished_at DESC NULLS LAST LIMIT 1
    ) AS last_error
    FROM run_cases rc JOIN runs r ON r.id = rc.run_id
    WHERE r.status IN ('running', 'pausing', 'stopping')
      AND rc.status NOT IN ('done', 'error', 'skipped')
      AND EXISTS (SELECT 1 FROM jobs j WHERE j.run_id = rc.run_id AND j.run_case_id = rc.id
                  AND j.status = 'failed')
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.run_id = rc.run_id AND j.run_case_id = rc.id
                      AND j.status IN ('queued', 'running'))
    """
)
STUCK_FINALIZING_SQL = text(
    """
    SELECT r.id FROM runs r
    WHERE r.status = 'finalizing'
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.run_id = r.id AND j.kind = 'run_finalize'
                      AND j.status IN ('queued', 'running'))
    """
)


async def sweep() -> None:
    """The safety net behind the handlers (run every few seconds by `worker/sweeper.py`):
    - a case whose job failed without recording an outcome (e.g. its lock expired too often)
      becomes `error`, so the run can still finish;
    - pausing/stopping runs settle once their in-flight cases died or finished;
    - a finalizing run whose finalize job is gone is marked failed."""
    async with session_scope() as session:
        orphans = (await session.execute(ORPHANS_SQL)).all()
        active = list(
            (
                await session.execute(
                    select(Run.id).where(Run.status.in_(("running", "pausing", "stopping")))
                )
            ).scalars()
        )
        stuck = list((await session.execute(STUCK_FINALIZING_SQL)).scalars())
    for row in orphans:
        await fail_case(row.id, "job", row.last_error or "The case's job failed.")
    for run_id in active:
        async with session_scope() as session:
            run = await lock_run(session, run_id, skip_locked=True)
            if run is not None:
                await settle(session, run)
    for run_id in stuck:
        async with session_scope() as session:
            run = await lock_run(session, run_id, skip_locked=True)
            if run is not None and run.status == "finalizing":
                still_queued = await session.scalar(
                    text(
                        "SELECT 1 FROM jobs WHERE run_id = :run AND kind = 'run_finalize' "
                        "AND status IN ('queued', 'running')"
                    ),
                    {"run": run_id},
                )
                if not still_queued:
                    run.status = "failed"
                    run.error = "Finalize gave up (its job failed)."
                    run.finished_at = datetime.now(UTC)
