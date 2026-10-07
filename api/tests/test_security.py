from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.errors import install_exception_handlers
from app.core.security import (
    AdminDep,
    OrgDep,
    is_admin_role,
    is_banned,
    verify_api_key,
)
from tests.conftest import Seed


def headers(api_key: str, user_id: str | None = None) -> dict[str, str]:
    h = {"X-API-Key": api_key}
    if user_id:
        h["X-User-Id"] = user_id
    return h


# ── /v1/me: key + user resolution ───────────────────────────────────────────


async def test_no_key_is_401(client: AsyncClient) -> None:
    response = await client.get("/v1/me")

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "unauthorized", "message": "Missing or invalid API key."}
    }


async def test_wrong_key_is_401(client: AsyncClient) -> None:
    response = await client.get("/v1/me", headers={"X-API-Key": "not-the-key"})

    assert response.status_code == 401


async def test_wrong_key_is_401_even_with_a_real_user(client: AsyncClient, seed: Seed) -> None:
    response = await client.get(
        "/v1/me", headers={"X-API-Key": "not-the-key", "X-User-Id": seed.member_id}
    )

    assert response.status_code == 401


async def test_key_without_user_id_is_401(client: AsyncClient, api_key: str) -> None:
    response = await client.get("/v1/me", headers=headers(api_key))

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Missing X-User-Id header."


async def test_unknown_user_is_403(client: AsyncClient, api_key: str) -> None:
    response = await client.get("/v1/me", headers=headers(api_key, "no-such-user"))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


async def test_banned_user_is_403(client: AsyncClient, api_key: str, seed: Seed) -> None:
    response = await client.get("/v1/me", headers=headers(api_key, seed.banned_id))

    assert response.status_code == 403


async def test_member_sees_only_their_orgs(client: AsyncClient, api_key: str, seed: Seed) -> None:
    response = await client.get("/v1/me", headers=headers(api_key, seed.member_id))

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["id"] == seed.member_id
    assert body["user"]["is_admin"] is False
    assert [o["id"] for o in body["orgs"]] == [seed.org_id]
    assert body["orgs"][0] == {
        "id": seed.org_id,
        "name": body["orgs"][0]["name"],
        "slug": seed.org_slug,
        "role": "member",
    }


async def test_outsider_has_no_orgs(client: AsyncClient, api_key: str, seed: Seed) -> None:
    response = await client.get("/v1/me", headers=headers(api_key, seed.outsider_id))

    assert response.status_code == 200
    assert response.json()["orgs"] == []


async def test_admin_sees_every_org(client: AsyncClient, api_key: str, seed: Seed) -> None:
    response = await client.get("/v1/me", headers=headers(api_key, seed.admin_id))

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["is_admin"] is True
    test_org = next(o for o in body["orgs"] if o["id"] == seed.org_id)
    assert test_org["role"] is None  # admin isn't a member


# ── require_org_access / require_admin, on a probe app ──────────────────────

probe = FastAPI()
install_exception_handlers(probe)
probe_router = APIRouter(prefix="/v1", dependencies=[Depends(verify_api_key)])


@probe_router.get("/orgs/{org_id}/probe")
async def org_probe(org: OrgDep) -> dict:
    return {"org_id": org.org_id, "role": org.role, "is_admin": org.is_admin}


@probe_router.get("/admin-probe")
async def admin_probe(actor: AdminDep) -> dict:
    return {"id": actor.id}


probe.include_router(probe_router)


@pytest.fixture
async def probe_client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=probe), base_url="http://test") as c:
        yield c


async def test_member_can_access_org(probe_client: AsyncClient, api_key: str, seed: Seed) -> None:
    response = await probe_client.get(
        f"/v1/orgs/{seed.org_id}/probe", headers=headers(api_key, seed.member_id)
    )

    assert response.status_code == 200
    assert response.json() == {"org_id": seed.org_id, "role": "member", "is_admin": False}


async def test_non_member_gets_404(probe_client: AsyncClient, api_key: str, seed: Seed) -> None:
    response = await probe_client.get(
        f"/v1/orgs/{seed.org_id}/probe", headers=headers(api_key, seed.outsider_id)
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


async def test_admin_can_access_any_org(
    probe_client: AsyncClient, api_key: str, seed: Seed
) -> None:
    response = await probe_client.get(
        f"/v1/orgs/{seed.org_id}/probe", headers=headers(api_key, seed.admin_id)
    )

    assert response.status_code == 200
    assert response.json() == {"org_id": seed.org_id, "role": None, "is_admin": True}


async def test_admin_gets_404_for_missing_org(
    probe_client: AsyncClient, api_key: str, seed: Seed
) -> None:
    response = await probe_client.get(
        "/v1/orgs/no-such-org/probe", headers=headers(api_key, seed.admin_id)
    )

    assert response.status_code == 404


async def test_require_admin(probe_client: AsyncClient, api_key: str, seed: Seed) -> None:
    as_admin = await probe_client.get("/v1/admin-probe", headers=headers(api_key, seed.admin_id))
    as_member = await probe_client.get("/v1/admin-probe", headers=headers(api_key, seed.member_id))

    assert as_admin.status_code == 200
    assert as_member.status_code == 403


# ── pure helpers ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        ("admin", True),
        ("user,admin", True),
        ("admin, user", True),
        ("user", False),
        ("superadmin", False),
        (None, False),
        ("", False),
    ],
)
def test_is_admin_role(role: str | None, expected: bool) -> None:
    assert is_admin_role(role) is expected


def test_is_banned_honours_expiry() -> None:
    now = datetime.now(UTC)

    assert is_banned(True, None) is True
    assert is_banned(True, now + timedelta(hours=1)) is True
    assert is_banned(True, now - timedelta(hours=1)) is False
    assert is_banned(False, None) is False
    assert is_banned(None, None) is False
