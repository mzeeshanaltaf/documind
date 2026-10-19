"""The web's Settings and Dashboard: connectivity (eval API, DocuMind, Anthropic), the service
users, pricing file hashes and this month's spend."""

import asyncio
import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import is_admin_role, is_banned
from app.documind.client import get_documind
from app.judge import pricing
from app.judge.client import get_client
from app.judge.pricing import PRICING_FILE as JUDGE_PRICING_FILE
from app.models import JudgeCall, Run
from app.services.runs import file_sha256

logger = logging.getLogger(__name__)

CHECK_TIMEOUT_S = 5
PROBE_MODEL = "claude-haiku-5-5"


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def documind_status() -> dict[str, Any]:
    """`/health` + `/admin/eval/info` (version, pricing and prompt hashes)."""
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_S):
            health = await get_documind().health()
            info = await get_documind().info()
    except Exception as exc:  # noqa: BLE001 — any failure means "unreachable"
        logger.warning("DocuMind status check failed: %s", type(exc).__name__)
        return {"reachable": False, "error": type(exc).__name__}
    return {
        "reachable": True,
        "url": get_settings().documind_api_url,
        "version": health.version,
        "pricing_sha256": info.get("pricing_sha256"),
        "prompt_hashes": info.get("prompt_hashes", {}),
        "chat_models": info.get("chat_models", []),
        "defaults": info.get("defaults", {}),
    }


async def anthropic_status() -> dict[str, Any]:
    """A free metadata call (`models.retrieve`): proves the key works without spending."""
    if not get_settings().anthropic_api_key:
        return {"configured": False, "reachable": False}
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_S):
            await get_client().models.retrieve(PROBE_MODEL)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Anthropic status check failed: %s", type(exc).__name__)
        return {"configured": True, "reachable": False, "error": type(exc).__name__}
    return {"configured": True, "reachable": True}


async def service_users(session: AsyncSession) -> list[dict[str, Any]]:
    settings = get_settings()
    wanted = {
        "service": settings.eval_service_user_id,
        "probe": settings.eval_probe_user_id,
    }
    ids = [user_id for user_id in wanted.values() if user_id]
    rows: dict[str, Any] = {}
    if ids:
        sql = text(
            'SELECT id, email, name, role, banned, "banExpires" AS ban_expires '
            f'FROM "{settings.eval_auth_schema}"."user" WHERE id = ANY(:ids)'
        )
        rows = {row.id: row for row in (await session.execute(sql, {"ids": ids})).all()}
    out = []
    for role, user_id in wanted.items():
        row = rows.get(user_id) if user_id else None
        out.append(
            {
                "role": role,
                "id": user_id,
                "found": row is not None,
                "email": row.email if row else None,
                "name": row.name if row else None,
                "is_admin": is_admin_role(row.role) if row else False,
                "banned": is_banned(row.banned, row.ban_expires) if row else False,
            }
        )
    return out


async def spend(session: AsyncSession) -> dict[str, Any]:
    """This UTC month: judge spend from `judge_calls` (every metered call, interrupted runs
    included) and DocuMind spend from the runs created this month."""
    since = month_start()
    judge = await session.scalar(
        select(func.coalesce(func.sum(JudgeCall.cost_usd), 0)).where(JudgeCall.created_at >= since)
    )
    documind, runs = (
        await session.execute(
            select(func.coalesce(func.sum(Run.documind_cost_usd), 0), func.count()).where(
                Run.created_at >= since
            )
        )
    ).one()
    return {
        "since": since.isoformat(),
        "judge_usd": float(Decimal(judge or 0)),
        "documind_usd": float(Decimal(documind or 0)),
        "runs": runs,
    }


async def system(session: AsyncSession) -> dict[str, Any]:
    settings = get_settings()
    documind, anthropic = await asyncio.gather(documind_status(), anthropic_status())
    return {
        "eval": {
            "version": settings.git_sha,
            "judge_pricing_sha256": file_sha256(JUDGE_PRICING_FILE),
            "judge_models": sorted(pricing.pricing()),
            "auth_schema": settings.eval_auth_schema,
            "db_schema": settings.db_schema,
            "worker_slots": settings.eval_worker_slots,
            "documind_concurrency": settings.eval_documind_concurrency,
            "judge_concurrency": settings.eval_judge_concurrency,
        },
        "documind": documind,
        "anthropic": anthropic,
        "service_users": await service_users(session),
        "spend": await spend(session),
    }
