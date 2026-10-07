"""Service API key + acting-user resolution.

Trust model: one service key (`DOCUMIND_API_KEY`) lives only in the Next.js server env and
Coolify secrets. Whoever holds it may act as any user by sending `X-User-Id`; the BFF sets
that header from a validated Better Auth session. The key is never sent to the browser.
"""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.models.auth import member_table, organization_table, user_table

api_key_header = APIKeyHeader(
    name="X-API-Key",
    auto_error=False,
    description="Service API key shared with the Next.js BFF.",
)


@dataclass(frozen=True)
class Actor:
    id: str
    email: str
    name: str
    is_admin: bool


@dataclass(frozen=True)
class OrgContext:
    org_id: str
    role: str | None  # the actor's `member.role`; None for a platform admin who isn't a member
    is_admin: bool


def is_admin_role(role: str | None) -> bool:
    # Better Auth's admin plugin stores roles comma-separated (e.g. "admin,user").
    return "admin" in {part.strip() for part in (role or "").split(",")}


def is_banned(banned: bool | None, ban_expires: datetime | None) -> bool:
    # Better Auth lifts expired bans lazily (on next sign-in), so honour the expiry here.
    return bool(banned) and (ban_expires is None or ban_expires > datetime.now(UTC))


async def verify_api_key(api_key: Annotated[str | None, Security(api_key_header)]) -> None:
    expected = get_settings().documind_api_key.encode()
    if not api_key or not secrets.compare_digest(api_key.encode(), expected):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing or invalid API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_actor(
    _: Annotated[None, Depends(verify_api_key)],
    session: SessionDep,
    user_id: Annotated[
        str | None,
        Header(alias="X-User-Id", description="Better Auth user id of the acting user."),
    ] = None,
) -> Actor:
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-User-Id header.")

    row = (
        await session.execute(
            select(
                user_table.c.id,
                user_table.c.email,
                user_table.c.name,
                user_table.c.role,
                user_table.c.banned,
                user_table.c.ban_expires,
            ).where(user_table.c.id == user_id)
        )
    ).one_or_none()
    if row is None or is_banned(row.banned, row.ban_expires):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User is unknown or suspended.")

    return Actor(id=row.id, email=row.email, name=row.name, is_admin=is_admin_role(row.role))


ActorDep = Annotated[Actor, Depends(get_actor)]


async def require_admin(actor: ActorDep) -> Actor:
    if not actor.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admin access required.")
    return actor


async def require_org_access(org_id: str, actor: ActorDep, session: SessionDep) -> OrgContext:
    """Admins reach every existing org; others need a `member` row. 404 either way, so
    callers can't probe which org ids exist."""
    not_found = HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found.")
    role = (
        await session.execute(
            select(member_table.c.role).where(
                member_table.c.organization_id == org_id, member_table.c.user_id == actor.id
            )
        )
    ).scalar_one_or_none()

    if role is not None:
        return OrgContext(org_id=org_id, role=role, is_admin=actor.is_admin)
    if not actor.is_admin:
        raise not_found

    exists = (
        await session.execute(
            select(organization_table.c.id).where(organization_table.c.id == org_id)
        )
    ).scalar_one_or_none()
    if exists is None:
        raise not_found
    return OrgContext(org_id=org_id, role=None, is_admin=True)


AdminDep = Annotated[Actor, Depends(require_admin)]
OrgDep = Annotated[OrgContext, Depends(require_org_access)]
