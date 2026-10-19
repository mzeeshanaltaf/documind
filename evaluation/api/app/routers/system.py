"""The web's Settings/Dashboard data."""

from typing import Any

from fastapi import APIRouter

from app.core.security import AdminDep, SessionDep
from app.services import system as system_service

router = APIRouter(tags=["system"])


@router.get("/system")
async def system(_: AdminDep, session: SessionDep) -> dict[str, Any]:
    """Connectivity (DocuMind, Anthropic), service users, pricing hashes, this month's spend."""
    return await system_service.system(session)
