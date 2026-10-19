import asyncio
import logging

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.documind.client import get_documind

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

CHECK_TIMEOUT_S = 5  # a cold connect from a dev machine to the VPS can take ~3 s


class DocuMindHealth(BaseModel):
    reachable: bool
    version: str | None = None


class HealthOut(BaseModel):
    status: str  # ok | degraded
    db: str  # ok | error
    version: str
    documind: DocuMindHealth


async def _db_ok() -> bool:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_S), engine.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception as exc:  # noqa: BLE001 — any failure just means "db: error"
        logger.warning("Health DB check failed: %s", type(exc).__name__)
        return False
    return True


async def _documind() -> DocuMindHealth:
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_S):
            health = await get_documind().health()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Health DocuMind check failed: %s", type(exc).__name__)
        return DocuMindHealth(reachable=False)
    return DocuMindHealth(reachable=True, version=health.version)


@router.get("/health")
async def health() -> HealthOut:
    """Public liveness + DB + DocuMind probe. Always HTTP 200, so a shared-DB or DocuMind blip
    doesn't make Coolify restart the container. `version` is the deployed commit."""
    db_ok, documind = await asyncio.gather(_db_ok(), _documind())
    return HealthOut(
        status="ok" if db_ok and documind.reachable else "degraded",
        db="ok" if db_ok else "error",
        version=get_settings().git_sha,
        documind=documind,
    )
