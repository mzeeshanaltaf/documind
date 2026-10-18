"""Monthly message/token quota: the caller's own status, and platform-admin controls."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.security import ActorDep, AdminDep, SessionDep
from app.schemas.quota import QuotaIn, QuotaListOut, QuotaOut
from app.services import quota as service

router = APIRouter(tags=["quota"])


@router.get("/me/quota")
async def my_quota(actor: ActorDep, session: SessionDep) -> QuotaOut:
    """This month's allowance and usage (UTC calendar month, renews on the 1st)."""
    return await service.get_status(session, actor)


@router.get("/admin/quotas")
async def list_quotas(
    _: AdminDep,
    session: SessionDep,
    user_id: Annotated[list[str], Query(max_length=200, description="Repeat for each user.")],
) -> QuotaListOut:
    """Limits and this month's usage for the given users, plus the default allowance."""
    return QuotaListOut(
        quotas=await service.get_statuses(session, list(dict.fromkeys(user_id))),
        defaults=service.defaults(),
    )


@router.put("/admin/users/{target_id}/quota")
async def set_quota(
    admin: AdminDep, session: SessionDep, target_id: str, body: QuotaIn
) -> QuotaOut:
    """Set a user's monthly limits (raise or lower them; takes effect immediately)."""
    return await service.set_limits(
        session,
        target_id,
        message_limit=body.message_limit,
        token_limit=body.token_limit,
        updated_by=admin.id,
    )


@router.delete("/admin/users/{target_id}/quota")
async def reset_quota(_: AdminDep, session: SessionDep, target_id: str) -> QuotaOut:
    """Back to the default allowance."""
    return await service.reset_limits(session, target_id)
