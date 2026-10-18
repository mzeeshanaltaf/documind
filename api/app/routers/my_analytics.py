"""The caller's own activity in an org (any member; nobody sees anyone else's)."""

from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from app.core.security import ActorDep, OrgDep, SessionDep
from app.services import analytics as ranges
from app.services import my_analytics as service
from app.services import quota

router = APIRouter(tags=["analytics"])


@router.get("/orgs/{org_id}/me/analytics")
async def get_my_analytics(
    org: OrgDep,
    actor: ActorDep,
    session: SessionDep,
    from_: Annotated[date | None, Query(alias="from", description="UTC date, inclusive.")] = None,
    to: Annotated[date | None, Query(description="UTC date, inclusive.")] = None,
    granularity: Literal["day", "week"] = "day",
) -> dict[str, Any]:
    """Conversations, questions, tokens, ratings and response times for the actor in this org
    (default: the last 30 days), plus the account-wide monthly quota."""
    start, end = ranges.resolve_range(from_, to)
    data = await service.my_analytics(
        session,
        org_id=org.org_id,
        user_id=actor.id,
        start=start,
        end=end,
        granularity=granularity,
    )
    data["quota"] = (await quota.get_status(session, actor)).model_dump(mode="json")
    return data
