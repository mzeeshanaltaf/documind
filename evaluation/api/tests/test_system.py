"""E5 endpoints for the web: `/v1/system` (connectivity, service users, spend) and `/v1/trends`
(metric series across completed runs), plus `judge_calls` on the case detail."""

import uuid
from typing import Any

import httpx
import pytest

from app.core.db import session_scope
from app.models import DatasetVersion
from app.services import system as system_service
from tests.test_runs import (  # noqa: F401 (fixtures)
    QUESTION,
    MockDocuMind,
    _clean,
    documind,
    drain,
    published_version,
    start_run,
)

pytestmark = pytest.mark.db


async def dataset_of(version_id: uuid.UUID) -> uuid.UUID:
    async with session_scope() as session:
        version = await session.get(DatasetVersion, version_id)
        assert version is not None
        return version.dataset_id


async def test_trends_follow_completed_runs_of_a_dataset(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    version_id = await published_version([QUESTION] * 2)
    first = await start_run(api, version_id, name="one")
    await drain()
    second = await start_run(api, version_id, name="two")
    await drain()
    other = await start_run(api, await published_version([QUESTION]), name="elsewhere")
    await drain()

    dataset_id = await dataset_of(version_id)
    response = await api.get(
        "/v1/trends", params=[("dataset_id", str(dataset_id)), ("metrics", "hit@5,case_pass")]
    )
    assert response.status_code == 200, response.text
    series: dict[str, list[dict[str, Any]]] = response.json()["series"]
    assert set(series) == {"hit@5", "case_pass"}
    assert [p["run_id"] for p in series["hit@5"]] == [first["id"], second["id"]]  # oldest first
    point = series["hit@5"][0]
    assert (point["mode"], point["mean"], point["n"]) == ("chat", 1.0, 2)
    assert point["ci_low"] is not None and point["finished_at"]
    assert other["id"] not in {p["run_id"] for p in series["case_pass"]}

    # Repeated params work too, and `limit` keeps the newest runs.
    response = await api.get(
        "/v1/trends",
        params=[("metrics", "mrr"), ("metrics", "leakage"), ("limit", "1"), ("org", "simtora")],
    )
    series = response.json()["series"]
    assert [p["run_id"] for p in series["mrr"]] == [other["id"]]
    assert len(series["leakage"]) == 1


async def test_system_reports_connectivity_users_and_spend(
    api: httpx.AsyncClient,
    documind: MockDocuMind,
    admin_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def anthropic_ok() -> dict[str, Any]:
        return {"configured": True, "reachable": True}

    monkeypatch.setattr(system_service, "anthropic_status", anthropic_ok)
    run = await start_run(api, await published_version([QUESTION]))
    await drain()

    response = await api.get("/v1/system")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["documind"]["reachable"] and body["documind"]["version"] == "test-sha"
    assert body["anthropic"] == {"configured": True, "reachable": True}
    assert len(body["eval"]["judge_pricing_sha256"]) == 64
    assert "claude-haiku-5-5" in body["eval"]["judge_models"]
    service = next(u for u in body["service_users"] if u["role"] == "service")
    assert service["id"] == admin_id and service["found"] and service["is_admin"]
    assert body["spend"]["runs"] >= 1
    assert body["spend"]["documind_usd"] > 0 and body["spend"]["judge_usd"] == 0

    # Judge off: the case detail carries an empty judge_calls list.
    cases = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"]
    detail = (await api.get(f"/v1/runs/{run['id']}/cases/{cases[0]['id']}")).json()
    assert detail["judge_calls"] == []


async def test_system_survives_an_unreachable_documind(
    api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def unreachable() -> dict[str, Any]:
        return {"configured": False, "reachable": False}

    monkeypatch.setattr(system_service, "anthropic_status", unreachable)

    class Down:
        async def health(self) -> None:
            raise httpx.ConnectError("down")

    monkeypatch.setattr(system_service, "get_documind", lambda: Down())
    body = (await api.get("/v1/system")).json()
    assert body["documind"] == {"reachable": False, "error": "ConnectError"}
    assert body["anthropic"]["reachable"] is False
