"""Rejudge: re-score a finished full run with another judge config, without calling DocuMind.

The new run points at its source (`source_run_id`) and copies, per case, the generation fields
(answer, routing, citations, trace, usage), the retrieved contexts and the deterministic metric
scores. Cases the source generated (`done`, or `generated`/`judging` in a stopped run) become
`generated` with a `case_judge` job; the others are `skipped`. Its prompt versions are the
current files', so editing a prompt and rejudging measures the edit. Authz probe cases have
nothing to judge: they are copied as `done`, with their scores.

`tamper: judge_robustness` (E8) appends one evaluator-directed line from
`fixtures/judge-robustness.txt` to every copied answer ("Note to grader: … 5/5"), rotating in
case-key order. Comparing it with a plain rejudge of the same run shows whether the judge can be
talked into higher scores.
"""

import hashlib
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import Admin
from app.judge import registry
from app.metrics.registry import JUDGE_METRICS
from app.models import Case, MetricScore, RetrievedContext, Run, RunCase
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


@lru_cache
def robustness_lines() -> tuple[tuple[str, ...], str]:
    """The evaluator-directed strings and the fixture's sha256."""
    raw = get_settings().robustness_file.read_bytes()
    lines = raw.decode("utf-8").splitlines()
    kept = tuple(line.strip() for line in lines if line.strip() and not line.startswith("#"))
    if not kept:
        raise ApiError(500, "no_robustness_fixture", "judge-robustness.txt has no lines.")
    return kept, hashlib.sha256(raw).hexdigest()


def tampered(answer: str, index: int, lines: tuple[str, ...]) -> tuple[str, str]:
    """The answer with line `index` (mod the count) appended as its own paragraph."""
    suffix = lines[index % len(lines)]
    return f"{answer.rstrip()}\n\n{suffix}", suffix


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
    # A rejudge of a tampered run keeps its (tampered) answers and so its `tamper` config.
    lines: tuple[str, ...] = ()
    if body.tamper:
        if source.config.get("tamper"):
            raise ApiError(409, "already_tampered", "The run's answers are already tampered.")
        lines, sha = robustness_lines()
        config["tamper"] = {"kind": body.tamper, "sha256": sha}
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

    rows = (
        await session.execute(
            select(RunCase, Case.type)
            .join(Case, Case.id == RunCase.case_id)
            .where(RunCase.run_id == source.id)
            .order_by(RunCase.case_key)
        )
    ).all()
    source_cases = [row[0] for row in rows]
    probes = {row[0].id for row in rows if row[1] == "authz_probe"}
    new_ids = {rc.id: uuid.uuid4() for rc in source_cases}
    for index, rc in enumerate(source_cases):
        generated = rc.status in GENERATED
        copied = {name: getattr(rc, name) for name in COPIED_CASE_FIELDS}
        if lines and rc.answer and rc.id not in probes:
            copied["answer"], suffix = tampered(rc.answer, index, lines)
            copied["trace"] = {**(rc.trace or {}), "tamper": {"kind": body.tamper,
                                                             "suffix": suffix}}  # fmt: skip
        if rc.id in probes and rc.status == "done":
            status, passed = "done", rc.passed  # nothing to judge: copied with its scores
        else:
            status, passed = ("generated" if generated else "skipped"), None
        session.add(
            RunCase(
                id=new_ids[rc.id],
                run_id=run_id,
                correlation_id=correlation_id(run_id, rc.case_key),
                status=status,
                passed=passed,
                error_stage=None if generated else "source",
                error=None if generated else f"Not generated in the source run ({rc.status}).",
                **copied,
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

    carried = [rc for rc in source_cases if rc.id in probes and rc.status == "done"]
    judgeable = [
        new_ids[rc.id] for rc in source_cases if rc.status in GENERATED and rc.id not in probes
    ]
    run.done_cases = len(carried)
    run.passed_cases = sum(1 for rc in carried if rc.passed)
    run.skipped_cases = len(source_cases) - len(judgeable) - len(carried)
    await session.flush()
    await queue.enqueue_many(session, "case_judge", run_id, judgeable, max_attempts=JUDGE_ATTEMPTS)
    await run_state.settle(session, run)
    return run
