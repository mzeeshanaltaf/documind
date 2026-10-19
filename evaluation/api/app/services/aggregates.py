"""Run aggregates: for every metric × mode × slice, n, mean, a 95 % CI and the pass rate.

- Binary metrics get a Wilson interval; continuous ones a percentile bootstrap (B = 2000,
  seeded from the run id and metric, so recomputing gives the same numbers).
- Only `ok` scores enter the mean; `na`/`error`/`refusal` are counted in `details`.
- Latency and TTFT also get p50/p95.
- Two run-level rows per mode come from case statuses: `case_pass` (passed / scored cases) and
  `error_rate` (errored / finished cases).
- Slices: `all`, `type:*`, `dept:*` (expected departments), `juris:*` (`juris:none` when the case
  names no country), `tag:*`, `difficulty:*`, `source:*`.
"""

import asyncio
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, select

from app.core.db import session_scope
from app.metrics.registry import REGISTRY
from app.models import Case, MetricScore, Run, RunAggregate, RunCase
from app.stats.bootstrap import bootstrap_ci, percentile, stable_seed
from app.stats.intervals import wilson

PERCENTILE_SCALES = frozenset({"ms"})


@dataclass(frozen=True)
class CaseRow:
    run_case_id: uuid.UUID
    status: str
    passed: bool | None
    type: str
    departments: tuple[str, ...] = ()
    jurisdiction: str | None = None
    tags: tuple[str, ...] = ()
    difficulty: str | None = None
    source: str | None = None


@dataclass(frozen=True)
class ScoreRow:
    run_case_id: uuid.UUID
    metric: str
    mode: str
    value: float | None
    status: str
    passed: bool | None


@dataclass
class Bucket:
    values: list[float] = field(default_factory=list)
    passed: list[bool] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))


def slices_of(case: CaseRow) -> list[str]:
    slices = ["all", f"type:{case.type}"]
    slices += [f"dept:{d}" for d in dict.fromkeys(case.departments)]
    slices.append(f"juris:{case.jurisdiction or 'none'}")
    slices += [f"tag:{t}" for t in dict.fromkeys(case.tags)]
    if case.difficulty:
        slices.append(f"difficulty:{case.difficulty}")
    if case.source:
        slices.append(f"source:{case.source}")
    return slices


def is_binary(metric: str) -> bool:
    spec = REGISTRY.get(metric)
    return spec is not None and spec.scale == "binary"


def summarize(
    run_id: str, metric: str, mode: str, slice_: str, bucket: Bucket, *, binary: bool
) -> dict[str, Any]:
    n = len(bucket.values)
    mean = sum(bucket.values) / n if n else None
    if binary:
        ci, method = wilson(sum(bucket.values), n), "wilson"
    else:
        ci, method = bootstrap_ci(bucket.values, stable_seed(run_id, metric)), "bootstrap"
    details: dict[str, Any] = {k: v for k, v in sorted(bucket.counts.items()) if v}
    spec = REGISTRY.get(metric)
    if spec is not None and spec.scale in PERCENTILE_SCALES and n:
        details["p50"] = percentile(bucket.values, 50)
        details["p95"] = percentile(bucket.values, 95)
    return {
        "metric": metric,
        "mode": mode,
        "slice": slice_,
        "n": n,
        "mean": mean,
        "ci_low": ci[0] if ci else None,
        "ci_high": ci[1] if ci else None,
        "ci_method": method if ci else None,
        "pass_rate": (sum(bucket.passed) / len(bucket.passed)) if bucket.passed else None,
        "details": details,
    }


def build_aggregates(
    run_id: str, cases: Sequence[CaseRow], scores: Iterable[ScoreRow], modes: Sequence[str]
) -> list[dict[str, Any]]:
    """Pure: the rows of `run_aggregates` for one run."""
    case_slices = {case.run_case_id: slices_of(case) for case in cases}
    done = {case.run_case_id for case in cases if case.status == "done"}
    buckets: dict[tuple[str, str, str], Bucket] = defaultdict(Bucket)
    for score in scores:
        if score.run_case_id not in done:
            continue
        for slice_ in case_slices[score.run_case_id]:
            bucket = buckets[(score.metric, score.mode, slice_)]
            if score.status == "ok" and score.value is not None:
                bucket.values.append(float(score.value))
                if score.passed is not None:
                    bucket.passed.append(score.passed)
            else:
                bucket.counts[score.status] += 1
    rows = [
        summarize(run_id, metric, mode, slice_, bucket, binary=is_binary(metric))
        for (metric, mode, slice_), bucket in buckets.items()
    ]

    # Run-level rows from case statuses, repeated per mode so each mode's view is complete.
    status_buckets: dict[tuple[str, str], Bucket] = defaultdict(Bucket)
    for case in cases:
        for slice_ in case_slices[case.run_case_id]:
            if case.status == "done" and case.passed is not None:
                status_buckets[("case_pass", slice_)].values.append(float(case.passed))
            if case.status in ("done", "error"):
                status_buckets[("error_rate", slice_)].values.append(float(case.status == "error"))
            elif case.status == "skipped":
                status_buckets[("error_rate", slice_)].counts["skipped"] += 1
    for mode in modes:
        for (metric, slice_), bucket in status_buckets.items():
            rows.append(summarize(run_id, metric, mode, slice_, bucket, binary=True))
    return rows


def run_modes(run: Run) -> list[str]:
    return ["chat"] if run.mode == "full" else list(run.config.get("retrieval_modes") or [])


async def refresh(run_id: uuid.UUID) -> int:
    """Recompute and replace a run's aggregates. Returns the number of rows."""
    async with session_scope() as session:
        run = await session.get(Run, run_id)
        if run is None:
            return 0
        case_result = await session.execute(
            select(
                RunCase.id,
                RunCase.status,
                RunCase.passed,
                Case.type,
                Case.expected_departments,
                Case.expected_jurisdiction,
                Case.tags,
                Case.difficulty,
                Case.source,
            )
            .join(Case, Case.id == RunCase.case_id)
            .where(RunCase.run_id == run_id)
        )
        case_rows = [
            CaseRow(
                run_case_id=row[0],
                status=row[1],
                passed=row[2],
                type=row[3],
                departments=tuple(row[4] or ()),
                jurisdiction=row[5],
                tags=tuple(row[6] or ()),
                difficulty=row[7],
                source=row[8],
            )
            for row in case_result.all()
        ]
        score_rows = [
            ScoreRow(*row)
            for row in (
                await session.execute(
                    select(
                        MetricScore.run_case_id,
                        MetricScore.metric,
                        MetricScore.mode,
                        MetricScore.value,
                        MetricScore.status,
                        MetricScore.passed,
                    )
                    .join(RunCase, RunCase.id == MetricScore.run_case_id)
                    .where(RunCase.run_id == run_id)
                )
            ).all()
        ]
        modes = run_modes(run)
    # Thousands of bootstraps are CPU work: keep them off the event loop.
    rows = await asyncio.to_thread(build_aggregates, str(run_id), case_rows, score_rows, modes)
    async with session_scope() as session:
        await session.execute(delete(RunAggregate).where(RunAggregate.run_id == run_id))
        session.add_all(RunAggregate(run_id=run_id, **row) for row in rows)
    return len(rows)
