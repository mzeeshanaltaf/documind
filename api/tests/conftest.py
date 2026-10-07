import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.main import app


@pytest.fixture(autouse=True)
async def _dispose_engine() -> AsyncIterator[None]:
    # Each test runs on its own event loop; pooled asyncpg connections can't cross loops.
    yield
    await engine.dispose()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def api_key() -> str:
    return get_settings().documind_api_key


@dataclass(frozen=True)
class Seed:
    org_id: str
    org_slug: str
    member_id: str  # regular user, member of the org
    outsider_id: str  # regular user, no membership
    admin_id: str  # platform admin, not a member
    banned_id: str  # banned member


@pytest.fixture
async def seed() -> AsyncIterator[Seed]:
    """Throwaway Better Auth rows in the dev schema, removed afterwards (FKs cascade)."""
    tag = uuid.uuid4().hex[:10]
    s = Seed(
        org_id=f"test-org-{tag}",
        org_slug=f"test-{tag}",
        member_id=f"test-member-{tag}",
        outsider_id=f"test-outsider-{tag}",
        admin_id=f"test-admin-{tag}",
        banned_id=f"test-banned-{tag}",
    )
    users = [
        (s.member_id, "user", False),
        (s.outsider_id, "user", False),
        (s.admin_id, "admin", False),
        (s.banned_id, "user", True),
    ]
    async with engine.begin() as conn:
        for user_id, role, banned in users:
            await conn.execute(
                text(
                    'INSERT INTO "user" (id, name, email, "emailVerified", role, banned,'
                    ' "createdAt", "updatedAt")'
                    " VALUES (:id, :name, :email, true, :role, :banned, now(), now())"
                ),
                {
                    "id": user_id,
                    "name": user_id,
                    "email": f"{user_id}@example.test",
                    "role": role,
                    "banned": banned,
                },
            )
        await conn.execute(
            text(
                'INSERT INTO organization (id, name, slug, "createdAt")'
                " VALUES (:id, :name, :slug, now())"
            ),
            {"id": s.org_id, "name": f"Test Org {tag}", "slug": s.org_slug},
        )
        for user_id in (s.member_id, s.banned_id):
            await conn.execute(
                text(
                    'INSERT INTO member (id, "organizationId", "userId", role, "createdAt")'
                    " VALUES (:id, :org, :user, 'member', now())"
                ),
                {"id": f"m-{user_id}", "org": s.org_id, "user": user_id},
            )
    try:
        yield s
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM organization WHERE id = :id"), {"id": s.org_id})
            await conn.execute(
                text('DELETE FROM "user" WHERE id = ANY(:ids)'),
                {"ids": [u[0] for u in users]},
            )
