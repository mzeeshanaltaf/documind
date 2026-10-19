"""The web's Settings/Dashboard data, and metric trends across runs."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.core.security import AdminDep, SessionDep
from app.services import system as system_service
from app.services import trends as trends_service

router = APIRouter(tags=["system"])


@router.get("/system")
async def system(_: AdminDep, session: SessionDep) -> dict[str, Any]:
    """Connectivity (DocuMind, Anthropic), service users, pricing hashes, this month's spend."""
    return await system_service.system(session)


@router.get("/trends")
async def trends(
    _: AdminDep,
    session: SessionDep,
    metrics: Annotated[list[str], Query(description="Repeat or comma-separate.")],
    dataset_id: uuid.UUID | None = None,
    org: str | None = None,
    slice_: Annotated[str, Query(alias="slice")] = "all",
    mode: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
) -> dict[str, Any]:
    """`{series: {metric: [{run_id, finished_at, mode, mean, ci_low, ci_high, n}]}}`, oldest
    first, over the latest `limit` completed, non-partial runs."""
    keys = [key.strip() for value in metrics for key in value.split(",") if key.strip()]
    series = await trends_service.series(
        session,
        dataset_id=dataset_id,
        org_slug=org,
        metrics=keys,
        slice_=slice_,
        mode=mode,
        limit=limit,
    )
    return {"series": series}
