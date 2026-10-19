"""`run_finalize`: aggregates, cost reconciliation, DocuMind cleanup, final status.

The counters are recounted from `run_cases` and `judge_calls` (self-healing), cases left
`generating`/`judging` by a dead worker go back to `pending`/`generated` (they were never
finished), and the status becomes `stopped` (partial), `failed` (no case succeeded) or
`completed`. A rejudge run made no DocuMind calls: it skips reconciliation and cleanup, and its
DocuMind cost stays 0.
"""

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import case, func, select, update

from app.core.db import session_scope
from app.documind.client import DocuMindError, get_documind
from app.models import JudgeCall, Run, RunCase
from app.services import aggregates, run_state
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)


async def handle(job: ClaimedJob) -> None:
    async with session_scope() as session:
        run = await session.get(Run, job.run_id)
    if run is None or run.status != "finalizing":
        return
    last_attempt = job.attempts >= job.max_attempts
    notes: list[str] = []
    try:
        await aggregates.refresh(run.id)
    except Exception as exc:
        if not last_attempt:
            raise
        logger.exception("Aggregates failed for run %s", run.id)
        notes.append(f"aggregates failed: {type(exc).__name__}: {exc}")
    if run.source_run_id is not None:
        await complete(run.id, None, notes)
        return

    documind = get_documind()
    reported: Decimal | None = None
    try:
        usage = await documind.run_usage(str(run.id))
        reported = Decimal(str((usage.get("totals") or {}).get("cost_usd") or 0))
    except DocuMindError as exc:
        if exc.retryable and not last_attempt:
            raise
        notes.append(f"cost reconciliation failed: {exc}")
    if run.mode == "full" and run.config.get("cleanup_conversations", True):
        try:
            deleted = await documind.delete_run_conversations(str(run.id))
            logger.info("Run %s: deleted %d DocuMind conversation(s)", run.id, deleted)
        except DocuMindError as exc:
            if exc.retryable and not last_attempt:
                raise
            notes.append(f"conversation cleanup failed: {exc}")
    await complete(run.id, reported, notes)


async def complete(run_id: uuid.UUID, reported: Decimal | None, notes: list[str]) -> None:
    async with session_scope() as session:
        run = await run_state.lock_run(session, run_id)
        if run is None or run.status != "finalizing":
            return
        for in_flight, back_to in (("generating", "pending"), ("judging", "generated")):
            await session.execute(
                update(RunCase)
                .where(RunCase.run_id == run_id, RunCase.status == in_flight)
                .values(status=back_to)
            )
        counts = (
            await session.execute(
                select(
                    func.count().filter(RunCase.status == "done"),
                    func.count().filter(RunCase.status == "error"),
                    func.count().filter(RunCase.status == "skipped"),
                    func.count().filter(RunCase.passed.is_(True)),
                    func.coalesce(
                        func.sum(case((RunCase.status == "done", RunCase.documind_cost_usd))), 0
                    ),
                    func.count(),
                ).where(RunCase.run_id == run_id)
            )
        ).one()
        done, failed, skipped, passed, cost, total = counts
        judge_cost = await session.scalar(
            select(func.coalesce(func.sum(JudgeCall.cost_usd), 0)).where(JudgeCall.run_id == run_id)
        )
        if run.source_run_id is not None:
            cost = Decimal(0)
        run.done_cases, run.failed_cases, run.skipped_cases = done, failed, skipped
        run.passed_cases, run.documind_cost_usd, run.total_cases = passed, cost, total
        run.judge_cost_usd = judge_cost
        run.documind_cost_reported_usd = reported
        run.partial = done + failed + skipped < total
        if run.partial:
            run.status = "stopped"
        elif done == 0 and failed > 0:
            run.status = "failed"
            notes.insert(0, "Every case failed.")
        else:
            run.status = "completed"
        run.error = "; ".join(notes) or None
        run.finished_at = datetime.now(UTC)
    logger.info("Run %s finalized", run_id)
