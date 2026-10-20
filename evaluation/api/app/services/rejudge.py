"""Rejudge: re-score a finished full run with another judge config, without calling DocuMind.

The new run points at its source (`source_run_id`) and copies, per case, the generation fields
(answer, routing, citations, trace, usage), the retrieved contexts and the deterministic metric
scores. Cases the source generated (`done`, or `generated`/`judging` in a stopped run) become
`generated` with a `case_judge` job; the others are `skipped`. Its prompt versions are the
current files', so editing a prompt and rejudging measures the edit.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.security import Admin
from app.judge import registry
from app.metrics.registry import JUDGE_METRICS
from app.models import MetricScore, RetrievedContext, Run, RunCase
from app.schemas.runs import RejudgeIn
from app.services import run_state
from app.services.case_results import JUDGE_ATTEMPTS
from app.services.runs import config_hash, correlation_id, eval_snapshot
from app.worker import queue

REJUDGEABLE = frozenset({"completed", "stopped"})
GENERATED = frozenset({"done", "generated", "judging"})
COPIED_CASE_FIELDS = (
    "case_id", "case_key", "answer", "routing", "citations", "needs_clarification", "trace",
    "latency_ms", "ttft_ms", "input_tokens", "cached_tokens", "output_tokens",
    "documind_cost_usd", "documind_usage",
)  # fmt: skip
NOT_COPIED = frozenset({"id", "run_case_id", "created_at", "judge_relevant"})


def _clone(row: Any, **values: Any) -> Any:
    """A new row of the same model with the same column values, minus ids and judge output."""
    columns = {
        attr.key: getattr(row, attr.key)
        for attr in row.__mapper__.column_attrs
        if attr.key not in NOT_COPIED
    }
    return type(row)(id=uuid.uuid4(), **{**columns, **values})


async def create_rejudge(
    session: AsyncSession, source_id: uuid.UUID, body: RejudgeIn, admin: Admin
) -> Run:
    source = await session.get(Run, source_id)
    if source is None:
        raise ApiError(404, "not_found", "Run not found.")
    if source.mode != "full":
        raise ApiError(409, "rejudge_full_only", "Only full runs have answers to rejudge.")
    if source.status not in REJUDGEABLE:
        raise ApiError(
            409,
            "run_not_finished",
            f"The run is {source.status}; rejudge a completed or stopped run.",
            {"status": source.status},
        )

    run_id = uuid.uuid4()
    config = {
        **source.config,
        "judge": body.judge.model_dump(),
        "metrics": body.metrics.model_dump() if body.metrics else source.config.get("metrics"),
        "rejudge_of": str(source.id),
        "cleanup_conversations": False,
    }
    snapshot = {
        **source.snapshot,
        "eval": eval_snapshot(),
        "prompts": await registry.sync(session, kind="judge"),
        "source_run": {
            "id": str(source.id),
            "config_hash": source.config_hash,
            "prompts": source.snapshot.get("prompts"),
            "eval": source.snapshot.get("eval"),
        },
    }
    run = Run(
        id=run_id,
        name=body.name or f"Rejudge of {source.name or str(source.id)[:8]}",
        dataset_version_id=source.dataset_version_id,
        org_id=source.org_id,
        org_slug=source.org_slug,
        mode=source.mode,
        status="running",
        source_run_id=source.id,
        config=config,
        config_hash=config_hash(config),
        snapshot=snapshot,
        total_cases=source.total_cases,
        max_judge_cost_usd=body.max_judge_cost_usd,
        tags=body.tags,
        created_by=admin.id,
        started_at=datetime.now(UTC),
    )
    session.add(run)
    await session.flush()

    source_cases = (await session.scalars(select(RunCase).where(RunCase.run_id == source.id))).all()
    new_ids = {rc.id: uuid.uuid4() for rc in source_cases}
    for rc in source_cases:
        generated = rc.status in GENERATED
        session.add(
            RunCase(
                id=new_ids[rc.id],
                run_id=run_id,
                correlation_id=correlation_id(run_id, rc.case_key),
                status="generated" if generated else "skipped",
                error_stage=None if generated else "source",
                error=None if generated else f"Not generated in the source run ({rc.status}).",
                **{name: getattr(rc, name) for name in COPIED_CASE_FIELDS},
            )
        )
    await session.flush()

    contexts = (
        await session.scalars(
            select(RetrievedContext).where(RetrievedContext.run_case_id.in_(list(new_ids)))
        )
    ).all()
    session.add_all(_clone(row, run_case_id=new_ids[row.run_case_id]) for row in contexts)
    scores = (
        await session.scalars(
            select(MetricScore).where(
                MetricScore.run_case_id.in_(list(new_ids)),
                MetricScore.metric.notin_(JUDGE_METRICS),
            )
        )
    ).all()
    session.add_all(_clone(row, run_case_id=new_ids[row.run_case_id]) for row in scores)

    judgeable = [new_ids[rc.id] for rc in source_cases if rc.status in GENERATED]
    run.skipped_cases = len(source_cases) - len(judgeable)
    await session.flush()
    await queue.enqueue_many(session, "case_judge", run_id, judgeable, max_attempts=JUDGE_ATTEMPTS)
    await run_state.settle(session, run)
    return run
