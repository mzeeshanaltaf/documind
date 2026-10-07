"""Usage analytics and the platform-admin org overview (platform admin only)."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from app.core.errors import ApiError
from app.core.security import AdminDep, SessionDep
from app.services import analytics as service

router = APIRouter(tags=["analytics"])

DEFAULT_DAYS = 30
MAX_DAYS = 366


@router.get("/analytics")
async def get_analytics(
    _: AdminDep,
    session: SessionDep,
    org_id: Annotated[str | None, Query(description="Omit for all orgs.")] = None,
    from_: Annotated[date | None, Query(alias="from", description="UTC date, inclusive.")] = None,
    to: Annotated[date | None, Query(description="UTC date, inclusive.")] = None,
    granularity: Literal["day", "week"] = "day",
) -> dict[str, Any]:
    """Totals, a cost/token timeseries and breakdowns (operation, model × tier, user, agent,
    cited documents, feedback). Defaults to the last 30 days."""
    end_day = to or datetime.now(UTC).date()
    start_day = from_ or end_day - timedelta(days=DEFAULT_DAYS - 1)
    if start_day > end_day:
        raise ApiError(422, "invalid_range", "`from` must not be after `to`.")
    if (end_day - start_day).days >= MAX_DAYS:
        raise ApiError(422, "invalid_range", f"The range is limited to {MAX_DAYS} days.")
    start = datetime.combine(start_day, time.min, UTC)
    end = datetime.combine(end_day + timedelta(days=1), time.min, UTC)
    return await service.analytics(
        session, org_id=org_id, start=start, end=end, granularity=granularity
    )


@router.get("/admin/orgs")
async def admin_orgs(_: AdminDep, session: SessionDep) -> dict[str, Any]:
    """Every org with its document and member counts and 30-day LLM cost."""
    return {"orgs": await service.admin_orgs(session)}
