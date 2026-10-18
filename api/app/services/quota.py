"""Monthly per-user quota: N messages and N tokens per calendar month (UTC), renewing on the 1st.

Limits come from `user_quotas` (a platform admin's override) or the env defaults. Usage lives in
`quota_usage` counters: `record_message` runs when a question is accepted, and `add_tokens` is
called for every metered LLM call (`llm/usage.py`), whatever the operation. A turn is refused
before it starts once either limit is reached; the turn that crosses the token limit finishes
(we can't know its size in advance), the next one is refused. Platform admins are never limited.
"""

import logging
from collections.abc import Sequence
from datetime import UTC, date, datetime

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.errors import ApiError
from app.core.security import Actor, is_admin_role
from app.models.auth import user_table
from app.models.quota import QuotaUsage, UserQuota
from app.schemas.quota import QuotaDefaults, QuotaOut

logger = logging.getLogger(__name__)


def current_period(now: datetime | None = None) -> date:
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    return date(moment.year, moment.month, 1)


def next_period(start: date) -> date:
    return date(start.year + (start.month == 12), start.month % 12 + 1, 1)


def defaults() -> QuotaDefaults:
    settings = get_settings()
    return QuotaDefaults(
        message_limit=settings.default_message_quota, token_limit=settings.default_token_quota
    )


def _status(
    user_id: str,
    *,
    unlimited: bool,
    custom: UserQuota | None,
    usage: QuotaUsage | None,
    period: date,
) -> QuotaOut:
    base = defaults()
    message_limit = custom.message_limit if custom else base.message_limit
    token_limit = custom.token_limit if custom else base.token_limit
    messages_used = usage.messages if usage else 0
    tokens_used = usage.tokens if usage else 0
    exhausted = None
    if not unlimited:
        if messages_used >= message_limit:
            exhausted = "messages"
        elif tokens_used >= token_limit:
            exhausted = "tokens"
    return QuotaOut(
        user_id=user_id,
        message_limit=message_limit,
        token_limit=token_limit,
        messages_used=messages_used,
        tokens_used=tokens_used,
        period_start=period,
        resets_on=next_period(period),
        is_custom=custom is not None,
        unlimited=unlimited,
        exhausted=exhausted,
    )


async def get_statuses(session: AsyncSession, user_ids: Sequence[str]) -> list[QuotaOut]:
    """Quota status for each existing user in `user_ids` (unknown ids are skipped)."""
    if not user_ids:
        return []
    period = current_period()
    roles = {
        row.id: row.role
        for row in (
            await session.execute(
                select(user_table.c.id, user_table.c.role).where(user_table.c.id.in_(user_ids))
            )
        ).all()
    }
    customs = {
        q.user_id: q
        for q in (
            await session.execute(select(UserQuota).where(UserQuota.user_id.in_(user_ids)))
        ).scalars()
    }
    usages = {
        u.user_id: u
        for u in (
            await session.execute(
                select(QuotaUsage).where(
                    QuotaUsage.user_id.in_(user_ids), QuotaUsage.period_start == period
                )
            )
        ).scalars()
    }
    return [
        _status(
            user_id,
            unlimited=is_admin_role(roles[user_id]),
            custom=customs.get(user_id),
            usage=usages.get(user_id),
            period=period,
        )
        for user_id in user_ids
        if user_id in roles
    ]


async def get_status(session: AsyncSession, actor: Actor) -> QuotaOut:
    (status,) = await get_statuses(session, [actor.id])
    return status


def _refusal(status: QuotaOut) -> ApiError:
    renews = f"{status.resets_on:%B} {status.resets_on.day}"
    if status.exhausted == "messages":
        message = (
            f"You've used all {status.message_limit:,} messages in your monthly quota. "
            f"It renews on {renews}."
        )
    else:
        message = (
            f"You've used your monthly quota of {status.token_limit:,} tokens. "
            f"It renews on {renews}."
        )
    return ApiError(429, "quota_exceeded", message, status.model_dump(mode="json"))


async def enforce(session: AsyncSession, actor: Actor) -> None:
    """Refuse the turn (429 `quota_exceeded`) when a limit is already reached."""
    if actor.is_admin:
        return
    status = await get_status(session, actor)
    if status.exhausted:
        raise _refusal(status)


async def record_message(session: AsyncSession, user_id: str) -> None:
    """Count one accepted question; committed with the caller's transaction."""
    await session.execute(
        pg_insert(QuotaUsage)
        .values(user_id=user_id, period_start=current_period(), messages=1, tokens=0)
        .on_conflict_do_update(
            index_elements=[QuotaUsage.user_id, QuotaUsage.period_start],
            set_={"messages": QuotaUsage.messages + 1},
        )
    )


async def add_tokens(user_id: str | None, tokens: int) -> None:
    """Add a metered call's tokens (input + output) to this month's counter. Never raises:
    like usage metering, it must not break the call it describes."""
    if not user_id or tokens <= 0:
        return
    try:
        async with session_scope() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO quota_usage (user_id, period_start, messages, tokens)
                    SELECT u.id, :period, 0, :tokens FROM "user" u WHERE u.id = :user_id
                    ON CONFLICT (user_id, period_start)
                    DO UPDATE SET tokens = quota_usage.tokens + EXCLUDED.tokens
                    """
                ),
                {"user_id": user_id, "period": current_period(), "tokens": tokens},
            )
    except Exception:
        logger.exception("Could not add %s tokens to the quota of %s", tokens, user_id)


async def set_limits(
    session: AsyncSession, user_id: str, *, message_limit: int, token_limit: int, updated_by: str
) -> QuotaOut:
    await _require_user(session, user_id)
    await session.execute(
        pg_insert(UserQuota)
        .values(
            user_id=user_id,
            message_limit=message_limit,
            token_limit=token_limit,
            updated_by=updated_by,
        )
        .on_conflict_do_update(
            index_elements=[UserQuota.user_id],
            set_={
                "message_limit": message_limit,
                "token_limit": token_limit,
                "updated_by": updated_by,
                "updated_at": func.now(),
            },
        )
    )
    await session.commit()
    return (await get_statuses(session, [user_id]))[0]


async def reset_limits(session: AsyncSession, user_id: str) -> QuotaOut:
    """Back to the default allowance."""
    await _require_user(session, user_id)
    await session.execute(delete(UserQuota).where(UserQuota.user_id == user_id))
    await session.commit()
    return (await get_statuses(session, [user_id]))[0]


async def _require_user(session: AsyncSession, user_id: str) -> None:
    exists = (
        await session.execute(select(user_table.c.id).where(user_table.c.id == user_id))
    ).scalar_one_or_none()
    if exists is None:
        raise ApiError(404, "not_found", "User not found.")
