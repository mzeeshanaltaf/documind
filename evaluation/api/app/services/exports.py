"""Run exports: CSV (one row per case: case fields, outcome, every metric's value) and JSON (the
run with its snapshot and aggregates, plus each case with its scores, details and contexts)."""

import csv
import io
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Case, MetricScore, RetrievedContext, Run, RunAggregate, RunCase
from app.schemas.datasets import CaseOut
from app.schemas.runs import AggregateOut, ContextOut, MetricScoreOut, RunOut

CASE_COLUMNS = ("case_key", "type", "expected_behavior", "difficulty", "source", "question")
OUTCOME_COLUMNS = (
    "status",
    "passed",
    "latency_ms",
    "ttft_ms",
    "input_tokens",
    "output_tokens",
    "documind_cost_usd",
    "error_stage",
    "error",
)


async def _cases(session: AsyncSession, run_id: Any) -> list[tuple[RunCase, Case]]:
    rows = await session.execute(
        select(RunCase, Case)
        .join(Case, Case.id == RunCase.case_id)
        .where(RunCase.run_id == run_id)
        .order_by(Case.position, Case.case_key)
    )
    return [(row[0], row[1]) for row in rows.all()]


async def _scores(session: AsyncSession, run_id: Any) -> list[MetricScore]:
    return list(
        (
            await session.execute(
                select(MetricScore)
                .join(RunCase, RunCase.id == MetricScore.run_case_id)
                .where(RunCase.run_id == run_id)
            )
        ).scalars()
    )


def _metric_column(run: Run, metric: str, mode: str) -> str:
    return metric if run.mode == "full" else f"{mode}:{metric}"


async def export_csv(session: AsyncSession, run: Run) -> str:
    cases = await _cases(session, run.id)
    by_case: dict[Any, dict[str, float | None]] = {}
    columns: dict[str, None] = {}
    for score in await _scores(session, run.id):
        column = _metric_column(run, score.metric, score.mode)
        columns.setdefault(column)
        by_case.setdefault(score.run_case_id, {})[column] = score.value
    metric_columns = sorted(columns)

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([*CASE_COLUMNS, "tags", *OUTCOME_COLUMNS, *metric_columns])
    for run_case, case in cases:
        values = by_case.get(run_case.id, {})
        writer.writerow(
            [
                *(getattr(case, column) for column in CASE_COLUMNS),
                ";".join(case.tags or []),
                *(_cell(getattr(run_case, column)) for column in OUTCOME_COLUMNS),
                *(_cell(values.get(column)) for column in metric_columns),
            ]
        )
    return buffer.getvalue()


def _cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


async def export_json(session: AsyncSession, run: Run) -> dict[str, Any]:
    cases = await _cases(session, run.id)
    scores: dict[Any, list[dict[str, Any]]] = {}
    for score in await _scores(session, run.id):
        scores.setdefault(score.run_case_id, []).append(
            MetricScoreOut.model_validate(score).model_dump(mode="json")
        )
    contexts: dict[Any, list[dict[str, Any]]] = {}
    for context in (
        await session.execute(
            select(RetrievedContext)
            .join(RunCase, RunCase.id == RetrievedContext.run_case_id)
            .where(RunCase.run_id == run.id)
            .order_by(RetrievedContext.mode, RetrievedContext.rank)
        )
    ).scalars():
        contexts.setdefault(context.run_case_id, []).append(
            ContextOut.model_validate(context).model_dump(mode="json")
        )
    aggregates = (
        await session.execute(select(RunAggregate).where(RunAggregate.run_id == run.id))
    ).scalars()
    return {
        "run": {
            **RunOut.model_validate(run).model_dump(mode="json"),
            "snapshot": run.snapshot,
        },
        "aggregates": [AggregateOut.model_validate(a).model_dump(mode="json") for a in aggregates],
        "cases": [
            {
                "case": CaseOut.model_validate(case).model_dump(mode="json"),
                "run_case": {
                    "id": str(run_case.id),
                    "status": run_case.status,
                    "attempt": run_case.attempt,
                    "correlation_id": run_case.correlation_id,
                    "conversation_id": _str(run_case.conversation_id),
                    "answer": run_case.answer,
                    "routing": run_case.routing,
                    "citations": run_case.citations,
                    "needs_clarification": run_case.needs_clarification,
                    "latency_ms": run_case.latency_ms,
                    "ttft_ms": run_case.ttft_ms,
                    "input_tokens": run_case.input_tokens,
                    "cached_tokens": run_case.cached_tokens,
                    "output_tokens": run_case.output_tokens,
                    "documind_cost_usd": _float(run_case.documind_cost_usd),
                    "documind_usage": run_case.documind_usage,
                    "passed": run_case.passed,
                    "error_stage": run_case.error_stage,
                    "error": run_case.error,
                    "trace": run_case.trace,
                },
                "scores": scores.get(run_case.id, []),
                "contexts": contexts.get(run_case.id, []),
            }
            for run_case, case in cases
        ],
    }


def _str(value: Any) -> str | None:
    return None if value is None else str(value)


def _float(value: Any) -> float | None:
    return None if value is None else float(value)
