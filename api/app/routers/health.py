import asyncio
import logging

from fastapi import APIRouter
from sqlalchemy import text

from app.core.db import engine
from app.schemas.health import HealthOut

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])

DB_CHECK_TIMEOUT_S = 5  # a cold connect from a dev machine to the VPS can take ~3s


@router.get("/health")
async def health() -> HealthOut:
    """Public liveness + DB probe. Always 200 so a shared-DB blip doesn't restart the container."""
    try:
        async with asyncio.timeout(DB_CHECK_TIMEOUT_S), engine.connect() as conn:
            await conn.execute(text("select 1"))
    except Exception as exc:  # noqa: BLE001 — any failure just means "db: error"
        logger.warning("Health DB check failed: %s", type(exc).__name__)
        return HealthOut(status="degraded", db="error")
    return HealthOut(status="ok", db="ok")
