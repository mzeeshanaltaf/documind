"""Metric trends across runs, with change markers (E5 dashboard, E6 trends page)."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.security import AdminDep, SessionDep
from app.models.enums import RunMode
from app.routers.compare import split_keys
from app.schemas.compare import TrendsOut
from app.services import trends as service

router = APIRouter(tags=["trends"])


@router.get("/trends")
async def trends(
    _: AdminDep,
    session: SessionDep,
    metrics: Annotated[list[str], Query(description="Repeat or comma-separate.")],
    dataset_id: uuid.UUID | None = None,
    org: str | None = None,
    slice_: Annotated[str, Query(alias="slice")] = "all",
    mode: Annotated[
        str | None, Query(description="Metric mode: chat, bm25, vector, hybrid.")
    ] = None,
    run_mode: Annotated[RunMode | None, Query(description="Default: the newest run's.")] = None,
    from_: Annotated[datetime | None, Query(alias="from", description="finished_at ≥")] = None,
    to: Annotated[datetime | None, Query(description="finished_at ≤")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
) -> TrendsOut:
    """Series per metric (`{run_id, finished_at, mode, mean, ci_low, ci_high, n}`, oldest
    first) over the latest `limit` completed, non-partial runs of one run mode, plus a marker on
    every run whose config hash, DocuMind version, judge prompt versions or dataset version
    differ from the run before it."""
    result = await service.series(
        session,
        dataset_id=dataset_id,
        org_slug=org,
        metrics=split_keys(metrics) or [],
        slice_=slice_,
        mode=mode,
        run_mode=run_mode,
        since=from_,
        until=to,
        limit=limit,
    )
    return TrendsOut.model_validate(result)
