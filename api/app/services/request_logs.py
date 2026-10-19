"""Reading and pruning `api_request_logs` (written by core/request_log.py)."""

import asyncio
import contextlib
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, Select, delete, func, or_, select, true, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.errors import ApiError
from app.models.auth import organization_table, user_table
from app.models.chat import Message
from app.models.request_log import ApiRequestLog
from app.models.usage import LlmUsage
from app.schemas.request_logs import (
    LlmCallOut,
    LlmTotalsOut,
    LogDetailOut,
    LogItemOut,
    LogListOut,
    LogMessageOut,
    LogOrgOut,
    LogUserOut,
)

logger = logging.getLogger(__name__)

PRUNE_INTERVAL_S = 3600
STATUS_CLASSES = {"2xx", "3xx", "4xx", "5xx"}


def _parse_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def encode_cursor(created_at: datetime, log_id: uuid.UUID) -> str:
    return f"{created_at.isoformat()}_{log_id}"


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    stamp, _, log_id = cursor.rpartition("_")
    try:
        return datetime.fromisoformat(stamp), uuid.UUID(log_id)
    except ValueError as exc:
        raise ApiError(422, "invalid_cursor", "The `before` cursor is malformed.") from exc


def status_filter(status: str) -> ColumnElement[bool]:
    column = ApiRequestLog.status_code
    if status in STATUS_CLASSES:
        low = int(status[0]) * 100
        return column.between(low, low + 99)
    if status.isdigit():
        return column == int(status)
    raise ApiError(422, "invalid_status", "`status` must be 2xx|3xx|4xx|5xx or a status code.")


def search_filter(q: str) -> ColumnElement[bool]:
    pattern = f"%{q}%"
    conditions: list[ColumnElement[bool]] = [
        ApiRequestLog.request_id == q,
        ApiRequestLog.path.ilike(pattern),
        ApiRequestLog.query.ilike(pattern),
        ApiRequestLog.error_message.ilike(pattern),
    ]
    if (log_id := _parse_uuid(q)) is not None:
        conditions.append(ApiRequestLog.id == log_id)
    return or_(*conditions)


def _usage_totals() -> Select:
    return select(
        func.coalesce(func.sum(LlmUsage.input_tokens + LlmUsage.output_tokens), 0).label(
            "total_tokens"
        ),
        func.coalesce(func.sum(LlmUsage.cost_usd), 0).label("cost_usd"),
    ).where(LlmUsage.request_id == ApiRequestLog.request_id)


async def list_logs(
    session: AsyncSession,
    *,
    q: str | None = None,
    method: str | None = None,
    status: str | None = None,
    route: str | None = None,
    user_id: str | None = None,
    org_id: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    before: str | None = None,
    after: str | None = None,
    limit: int = 50,
) -> LogListOut:
    """Newest first. `before` pages to older rows; `after` returns the `limit` rows just newer
    than the cursor (still newest first, no `next_cursor`). `total` is counted only on a first
    page (no cursor), so cursor calls such as the viewer's neighbour lookups stay cheap."""
    if before and after:
        raise ApiError(422, "invalid_cursor", "Pass `before` or `after`, not both.")
    conditions: list[ColumnElement[bool]] = []
    if q:
        conditions.append(search_filter(q.strip()))
    if method:
        conditions.append(ApiRequestLog.method == method.upper())
    if status:
        conditions.append(status_filter(status.strip().lower()))
    if route:
        conditions.append(ApiRequestLog.route == route)
    if user_id:
        conditions.append(ApiRequestLog.user_id == user_id)
    if org_id:
        conditions.append(ApiRequestLog.org_id == org_id)
    if since:
        conditions.append(ApiRequestLog.created_at >= since)
    if until:
        conditions.append(ApiRequestLog.created_at < until)

    total = None
    if not before and not after:
        total = await session.scalar(
            select(func.count()).select_from(ApiRequestLog).where(*conditions)
        )

    key = tuple_(ApiRequestLog.created_at, ApiRequestLog.id)
    order = (ApiRequestLog.created_at.desc(), ApiRequestLog.id.desc())
    if before:
        conditions.append(key < decode_cursor(before))
    if after:
        conditions.append(key > decode_cursor(after))
        order = (ApiRequestLog.created_at.asc(), ApiRequestLog.id.asc())

    usage = _usage_totals().lateral("usage")
    query = (
        select(
            ApiRequestLog,
            user_table.c.email.label("user_email"),
            organization_table.c.slug.label("org_slug"),
            usage.c.total_tokens,
            usage.c.cost_usd,
        )
        .outerjoin(user_table, user_table.c.id == ApiRequestLog.user_id)
        .outerjoin(organization_table, organization_table.c.id == ApiRequestLog.org_id)
        .outerjoin(usage, true())
        .where(*conditions)
        .order_by(*order)
        .limit(limit + 1)
    )
    rows = (await session.execute(query)).all()
    if after:
        rows = rows[:limit][::-1]
    items = [
        LogItemOut.model_validate(row.ApiRequestLog).model_copy(
            update={
                "user_email": row.user_email,
                "org_slug": row.org_slug,
                "total_tokens": int(row.total_tokens),
                "cost_usd": float(row.cost_usd),
            }
        )
        for row in rows[:limit]
    ]
    next_cursor = (
        encode_cursor(items[-1].created_at, items[-1].id) if len(rows) > limit and items else None
    )
    return LogListOut(items=items, next_cursor=next_cursor, total=total)


async def list_routes(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(ApiRequestLog.route)
        .where(ApiRequestLog.route.is_not(None))
        .distinct()
        .order_by(ApiRequestLog.route)
    )
    return [route for route in result.scalars() if route]


async def get_log(session: AsyncSession, log_id: uuid.UUID) -> LogDetailOut:
    log = await session.get(ApiRequestLog, log_id)
    if log is None:
        raise ApiError(404, "not_found", "Log entry not found.")
    detail = LogDetailOut.model_validate(log)

    if log.user_id:
        user = (
            await session.execute(
                select(user_table.c.id, user_table.c.name, user_table.c.email).where(
                    user_table.c.id == log.user_id
                )
            )
        ).one_or_none()
        detail.user = LogUserOut(id=user.id, name=user.name, email=user.email) if user else None
    if log.org_id:
        org = (
            await session.execute(
                select(
                    organization_table.c.id, organization_table.c.name, organization_table.c.slug
                ).where(organization_table.c.id == log.org_id)
            )
        ).one_or_none()
        detail.org = LogOrgOut(id=org.id, name=org.name, slug=org.slug) if org else None

    if log.request_id:
        calls = (
            await session.scalars(
                select(LlmUsage)
                .where(LlmUsage.request_id == log.request_id)
                .order_by(LlmUsage.created_at)
            )
        ).all()
        detail.llm_calls = [LlmCallOut.model_validate(call) for call in calls]
        detail.llm_totals = LlmTotalsOut(
            calls=len(calls),
            input_tokens=sum(c.input_tokens for c in calls),
            cached_tokens=sum(c.cached_tokens for c in calls),
            output_tokens=sum(c.output_tokens for c in calls),
            reasoning_tokens=sum(c.reasoning_tokens for c in calls),
            total_tokens=sum(c.input_tokens + c.output_tokens for c in calls),
            cost_usd=float(sum(c.cost_usd for c in calls)),
        )

    if log.message_id:
        message = await session.get(Message, log.message_id)
        if message is not None and message.role == "assistant":
            detail.message = LogMessageOut.model_validate(message)
    return detail


async def prune(retention_days: int) -> int:
    """Delete rows older than the retention window; returns how many went."""
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    async with session_scope() as session:
        result = await session.execute(
            delete(ApiRequestLog).where(ApiRequestLog.created_at < cutoff)
        )
    return result.rowcount or 0


async def run_pruner(stop: asyncio.Event) -> None:
    """Lifespan task: prune hourly until `stop` is set."""
    while not stop.is_set():
        try:
            deleted = await prune(get_settings().request_log_retention_days)
            if deleted:
                logger.info("Pruned %d request log(s)", deleted)
        except Exception:
            logger.exception("Request log prune failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), PRUNE_INTERVAL_S)
