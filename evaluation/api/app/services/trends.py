"""Metric series across runs (E5 dashboard sparklines, E6 trends) and change markers.

Reads `run_aggregates` of completed, non-partial runs of one run mode (full or retrieval_only;
default: the newest matching run's), oldest first. A marker sits on every run whose setup differs
from the run before it: the config hash, DocuMind's version, a judge prompt version or the
dataset version (`config_diff.kind_of`).
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Dataset, DatasetVersion, Run, RunAggregate
from app.services import config_diff


@dataclass(frozen=True)
class RunFacts:
    run_id: uuid.UUID
    finished_at: datetime | None
    mode: str
    config: dict[str, Any]
    config_hash: str
    snapshot: dict[str, Any]


def change_markers(runs: Sequence[RunFacts]) -> list[dict[str, Any]]:
    """Pure: one marker per run (oldest first) whose setup differs from its predecessor's."""
    markers = []
    for previous, current in zip(runs, runs[1:], strict=False):
        before = config_diff.comparable(previous.mode, previous.config, previous.snapshot)
        after = config_diff.comparable(current.mode, current.config, current.snapshot)
        changes = []
        for difference in config_diff.diff(before, after):
            kind = config_diff.kind_of(difference.key)
            if kind is None:
                continue
            changes.append({"kind": kind, **difference.as_dict()})
        # A config hash change that no visible key explains is still a change.
        if previous.config_hash != current.config_hash and not changes:
            changes.append(
                {
                    "kind": "config",
                    "key": "config_hash",
                    "a": previous.config_hash,
                    "b": current.config_hash,
                }
            )
        if changes:
            markers.append(
                {
                    "run_id": current.run_id,
                    "previous_run_id": previous.run_id,
                    "finished_at": current.finished_at,
                    "kinds": sorted({c["kind"] for c in changes}),
                    "changes": changes,
                }
            )
    return markers


def _filtered(
    stmt: Select[Any],
    *,
    dataset_id: uuid.UUID | None,
    org_slug: str | None,
    since: datetime | None,
    until: datetime | None,
) -> Select[Any]:
    stmt = stmt.where(Run.status == "completed", Run.partial.is_(False))
    if dataset_id is not None:
        stmt = stmt.where(DatasetVersion.dataset_id == dataset_id)
    if org_slug:
        stmt = stmt.where(Run.org_slug == org_slug)
    if since is not None:
        stmt = stmt.where(Run.finished_at >= since)
    if until is not None:
        stmt = stmt.where(Run.finished_at <= until)
    return stmt


async def series(
    session: AsyncSession,
    *,
    dataset_id: uuid.UUID | None,
    org_slug: str | None,
    metrics: list[str],
    slice_: str = "all",
    mode: str | None = None,
    run_mode: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    filters = {"dataset_id": dataset_id, "org_slug": org_slug, "since": since, "until": until}
    base = (
        select(Run, DatasetVersion.version, Dataset.slug)
        .join(DatasetVersion, DatasetVersion.id == Run.dataset_version_id)
        .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
    )
    if run_mode is None:
        latest = _filtered(base, **filters).order_by(Run.finished_at.desc()).limit(1)
        row = (await session.execute(latest)).first()
        run_mode = row[0].mode if row else None
    out: dict[str, Any] = {
        "run_mode": run_mode,
        "runs": [],
        "series": {metric: [] for metric in metrics},
        "markers": [],
        "slices": [],
    }
    if run_mode is None:
        return out

    picked = (
        await session.execute(
            _filtered(base, **filters)
            .where(Run.mode == run_mode)
            .order_by(Run.finished_at.desc())
            .limit(limit)
        )
    ).all()
    picked.reverse()  # oldest first
    run_ids = [run.id for run, *_ in picked]
    out["runs"] = [
        {
            "run_id": run.id,
            "name": run.name,
            "finished_at": run.finished_at,
            "dataset_version_id": run.dataset_version_id,
            "dataset_slug": slug,
            "dataset_version": version,
            "config_hash": run.config_hash,
            "documind_version": (run.snapshot.get("documind") or {}).get("version"),
            "source_run_id": run.source_run_id,
        }
        for run, version, slug in picked
    ]
    out["markers"] = change_markers(
        [
            RunFacts(run.id, run.finished_at, run.mode, run.config, run.config_hash, run.snapshot)
            for run, *_ in picked
        ]
    )
    if not run_ids:
        return out

    finished = {run.id: run.finished_at for run, *_ in picked}
    position = {run_id: i for i, run_id in enumerate(run_ids)}
    stmt = select(RunAggregate).where(
        RunAggregate.run_id.in_(run_ids),
        RunAggregate.slice == slice_,
        RunAggregate.metric.in_(metrics),
    )
    if mode:
        stmt = stmt.where(RunAggregate.mode == mode)
    aggregates = sorted(
        (await session.scalars(stmt)).all(), key=lambda a: (position[a.run_id], a.mode)
    )
    for aggregate in aggregates:
        out["series"][aggregate.metric].append(
            {
                "run_id": aggregate.run_id,
                "finished_at": finished[aggregate.run_id],
                "mode": aggregate.mode,
                "mean": aggregate.mean,
                "ci_low": aggregate.ci_low,
                "ci_high": aggregate.ci_high,
                "n": aggregate.n,
            }
        )
    out["slices"] = sorted(
        await session.scalars(
            select(RunAggregate.slice).where(RunAggregate.run_id.in_(run_ids)).distinct()
        )
    )
    return out
