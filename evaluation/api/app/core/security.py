"""Service API key + admin resolution.

Trust model (as in DocuMind): one service key (`EVAL_API_KEY`) lives only in the eval web's
server env and Coolify secrets. The web's BFF checks the Better Auth session, then sends the
user as `X-User-Id`. Only DocuMind platform admins may use the eval API at all.
"""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session

api_key_header = APIKeyHeader(
    name="X-API-Key",
    auto_error=False,
    description="Service API key shared with the eval web's BFF.",
)


@dataclass(frozen=True)
class Admin:
    id: str
    email: str
    name: str


def is_admin_role(role: str | None) -> bool:
    # Better Auth's admin plugin stores roles comma-separated (e.g. "admin,user").
    return "admin" in {part.strip() for part in (role or "").split(",")}


def is_banned(banned: bool | None, ban_expires: datetime | None) -> bool:
    # Better Auth lifts expired bans lazily (on next sign-in), so honour the expiry here.
    return bool(banned) and (ban_expires is None or ban_expires > datetime.now(UTC))


async def verify_api_key(api_key: Annotated[str | None, Security(api_key_header)]) -> None:
    expected = get_settings().eval_api_key.encode()
    if not api_key or not secrets.compare_digest(api_key.encode(), expected):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing or invalid API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


SessionDep = Annotated[AsyncSession, Depends(get_session)]


def user_sql() -> str:
    # DocuMind's Better Auth table: quoted (reserved word) and schema-qualified, because our own
    # search_path is the eval schema. The schema name is validated in Settings.
    schema = get_settings().eval_auth_schema
    return (
        'SELECT id, email, name, role, banned, "banExpires" AS ban_expires '
        f'FROM "{schema}"."user" WHERE id = :id'
    )


async def get_admin(
    _: Annotated[None, Depends(verify_api_key)],
    session: SessionDep,
    user_id: Annotated[
        str | None,
        Header(alias="X-User-Id", description="Better Auth user id of the acting admin."),
    ] = None,
) -> Admin:
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-User-Id header.")
    row = (await session.execute(text(user_sql()), {"id": user_id})).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user.")
    if is_banned(row.banned, row.ban_expires) or not is_admin_role(row.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admin access required.")
    return Admin(id=row.id, email=row.email, name=row.name)


AdminDep = Annotated[Admin, Depends(get_admin)]
