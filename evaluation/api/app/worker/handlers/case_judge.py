"""`case_judge`: run the enabled judge metrics on a generated case, then decide `passed`, mark it
`done` and count it (`case_results.save_judged`).

Each judge metric group runs in its own `try` (`services/judging.py`), so a failing metric gets
status `error` and the case still completes. A rate limit requeues the job; a run that reached
its judge budget, or whose Anthropic account refuses every call (`judge_unavailable`), pauses and
the job waits for a resume; a transient Anthropic error retries the
job (its paid calls are reused through `request_hash`). Only a failure to store the result on the
last attempt fails the case.
"""

import logging
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select

from app.core.db import session_scope
from app.judge.client import BudgetExceeded, JudgeCtx, JudgeUnavailable
from app.judge.registry import PromptSpec
from app.judge.render import CaseInputs, Turn
from app.metrics.registry import MetricConfig
from app.metrics.types import CaseSpec
from app.models import Case, RetrievedContext, Run, RunCase
from app.services import judging, run_state
from app.services.case_results import context_from_row, save_judged
from app.worker.errors import RetryLater
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)

JUDGEABLE = frozenset({"generated", "judging"})


@dataclass(frozen=True)
class JudgeJob:
    run: Run
    run_case: RunCase
    inputs: CaseInputs
    prompts: dict[str, PromptSpec]


async def handle(job: ClaimedJob) -> None:
    state = await begin(job)
    if state is None:
        return
    last_attempt = job.attempts >= job.max_attempts
    ctx = JudgeCtx(run_id=state.run.id, run_case_id=state.run_case.id)
    try:
        outcome = await judging.judge_case(
            state.inputs,
            state.prompts,
            MetricConfig.from_config(state.run.config.get("metrics")),
            judging.JudgeConfig.from_config(state.run.config.get("judge")),
            ctx,
            last_attempt=last_attempt,
        )
    except BudgetExceeded as exc:
        # The run is pausing; the job waits in the queue until it's resumed.
        raise RetryLater(timedelta(0), "judge budget reached") from exc
    except JudgeUnavailable as exc:
        # Every case would fail the same way: pause rather than turn them all into errors.
        async with session_scope() as session:
            await run_state.pause_for(session, state.run.id, "judge_unavailable")
        raise RetryLater(timedelta(0), f"judge unavailable: {exc}") from exc
    try:
        await save_judged(state.run, state.run_case.id, outcome)
    except Exception as exc:
        if not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "judge", f"{type(exc).__name__}: {exc}")


async def begin(job: ClaimedJob) -> JudgeJob | None:
    """Mark the case `judging` and load what the judge reads, unless the run says otherwise."""
    pause_for_budget = False
    async with session_scope() as session:
        run = (
            await session.execute(
                select(Run).where(Run.id == job.run_id).with_for_update(read=True)
            )
        ).scalar_one_or_none()
        run_case = await session.get(RunCase, job.run_case_id) if job.run_case_id else None
        if run is None or run_case is None or run_case.status not in JUDGEABLE:
            return None
        if run.status in ("pausing", "paused"):
            raise RetryLater(timedelta(0), "run paused")
        if run.status not in ("running", "stopping"):
            return None
        if run_state.over_budget(run):
            pause_for_budget = True
        else:
            case = await session.get(Case, run_case.case_id)
            if case is None:
                return None
            contexts = (
                await session.scalars(
                    select(RetrievedContext)
                    .where(RetrievedContext.run_case_id == run_case.id)
                    .order_by(RetrievedContext.mode, RetrievedContext.rank)
                )
            ).all()
            prompts = await judging.prompts_for(session, run.snapshot)
            run_case.status = "judging"
            run_case.attempt = job.attempts
            inputs = CaseInputs(
                case=CaseSpec.from_model(case),
                answer=run_case.answer or "",
                contexts=[context_from_row(row) for row in contexts],
                conversation=conversation_of(run_case),
                routing=run_case.routing,
                needs_clarification=bool(run_case.needs_clarification),
                citations=run_case.citations or [],
            )
    if pause_for_budget:
        async with session_scope() as session:
            await run_state.pause_for_budget(session, run.id)
        raise RetryLater(timedelta(0), "judge budget reached")
    return JudgeJob(run=run, run_case=run_case, inputs=inputs, prompts=prompts)


def conversation_of(run_case: RunCase) -> list[Turn]:
    """The setup turns and DocuMind's answers to them, from the case's trace."""
    turns: list[Turn] = []
    for entry in (run_case.trace or {}).get("turns") or []:
        if entry.get("kind") != "setup":
            continue
        turns.append(Turn("user", entry.get("message") or ""))
        turns.append(Turn("assistant", entry.get("answer") or ""))
    return turns
