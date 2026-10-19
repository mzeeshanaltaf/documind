"""Metric series across runs (E5: the dashboard sparklines; E6 adds change markers).

Reads `run_aggregates` of completed, non-partial runs, oldest first."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DatasetVersion, Run, RunAggregate


async def series(
    session: AsyncSession,
    *,
    dataset_id: uuid.UUID | None,
    org_slug: str | None,
    metrics: list[str],
    slice_: str = "all",
    mode: str | None = None,
    limit: int = 20,
) -> dict[str, list[dict[str, Any]]]:
    runs = (
        select(Run.id, Run.finished_at)
        .where(Run.status == "completed", Run.partial.is_(False))
        .order_by(Run.finished_at.desc())
        .limit(limit)
    )
    if dataset_id is not None:
        runs = runs.join(DatasetVersion, DatasetVersion.id == Run.dataset_version_id).where(
            DatasetVersion.dataset_id == dataset_id
        )
    if org_slug:
        runs = runs.where(Run.org_slug == org_slug)
    picked = runs.subquery()
    stmt = (
        select(RunAggregate, picked.c.finished_at)
        .join(picked, picked.c.id == RunAggregate.run_id)
        .where(RunAggregate.slice == slice_, RunAggregate.metric.in_(metrics))
        .order_by(picked.c.finished_at, RunAggregate.mode)
    )
    if mode:
        stmt = stmt.where(RunAggregate.mode == mode)
    out: dict[str, list[dict[str, Any]]] = {metric: [] for metric in metrics}
    for aggregate, finished_at in (await session.execute(stmt)).all():
        out[aggregate.metric].append(
            {
                "run_id": str(aggregate.run_id),
                "finished_at": finished_at.isoformat() if finished_at else None,
                "mode": aggregate.mode,
                "mean": aggregate.mean,
                "ci_low": aggregate.ci_low,
                "ci_high": aggregate.ci_high,
                "n": aggregate.n,
            }
        )
    return out
