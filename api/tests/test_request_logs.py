"""Request logs: capture middleware, read API, viewer page and pruning, against the dev DB."""

import re
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core import request_log
from app.core.config import get_settings
from app.core.db import engine
from app.main import app
from app.services import quota as quota_service
from app.services import request_logs
from tests.conftest import Seed
from tests.test_chat_stream import (  # noqa: F401  (fixtures)
    ANSWER,
    FakeOpenAI,
    _wait_for_titles,
    corpus,
    fake_openai,
    parse_sse,
)


def rid() -> str:
    return f"test-{uuid.uuid4().hex}"


@pytest.fixture
async def logging_on(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    monkeypatch.setattr(get_settings(), "request_log_enabled", True)
    yield
    await request_log.drain()
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "DELETE FROM api_request_logs"
                " WHERE request_id LIKE 'test-%' OR user_id LIKE 'test-%'"
            )
        )


async def _log(request_id: str) -> Any:
    await request_log.drain()
    async with engine.connect() as conn:
        return (
            await conn.execute(
                text("SELECT * FROM api_request_logs WHERE request_id = :r"), {"r": request_id}
            )
        ).one_or_none()


async def test_request_is_logged_with_route_and_redacted_key(
    client: AsyncClient, api_key: str, seed: Seed, logging_on: None
) -> None:
    request_id = rid()
    response = await client.get(
        "/v1/me",
        params={"probe": "1"},
        headers={"X-API-Key": api_key, "X-User-Id": seed.member_id, "X-Request-ID": request_id},
    )
    assert response.status_code == 200
    row = await _log(request_id)
    assert row is not None
    assert (row.method, row.path, row.query, row.route) == ("GET", "/v1/me", "probe=1", "/v1/me")
    assert row.status_code == 200 and row.duration_ms >= 0
    assert row.user_id == seed.member_id
    assert row.request_headers["x-api-key"] == "[REDACTED]"
    assert api_key not in str(row.request_headers)
    assert row.response_content_type.startswith("application/json")
    assert isinstance(row.response_body, dict) and row.error_code is None


async def test_health_and_logs_api_are_not_logged(
    client: AsyncClient, api_key: str, logging_on: None
) -> None:
    health_id, logs_id = rid(), rid()
    await client.get("/health", headers={"X-Request-ID": health_id})
    await client.get("/v1/logs", headers={"X-API-Key": api_key, "X-Request-ID": logs_id})
    assert await _log(health_id) is None
    assert await _log(logs_id) is None


async def test_errors_store_their_code(
    client: AsyncClient, api_key: str, seed: Seed, logging_on: None
) -> None:
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    missing_id, invalid_id, unauthorized_id = rid(), rid(), rid()

    missing = await client.get(
        f"/v1/conversations/{uuid.uuid4()}", headers={**member, "X-Request-ID": missing_id}
    )
    assert missing.status_code == 404
    invalid = await client.post(
        f"/v1/orgs/{seed.org_id}/chat", headers={**member, "X-Request-ID": invalid_id}, json={}
    )
    assert invalid.status_code == 422
    await client.get("/v1/me", headers={"X-API-Key": "nope", "X-Request-ID": unauthorized_id})

    row = await _log(missing_id)
    assert row.status_code == 404 and row.error_code == "not_found"
    assert row.route == "/v1/conversations/{conversation_id}" and row.conversation_id is not None
    row = await _log(invalid_id)
    assert row.status_code == 422 and row.error_code == "validation_error"
    assert row.org_id == seed.org_id and row.request_body == {}
    row = await _log(unauthorized_id)
    assert row.status_code == 401 and row.error_code == "unauthorized"


async def test_unhandled_exception_records_traceback(
    api_key: str, seed: Seed, logging_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(*_: Any, **__: Any) -> None:
        raise RuntimeError("quota store exploded")

    monkeypatch.setattr(quota_service, "get_status", boom)
    request_id = rid()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/v1/me/quota",
            headers={"X-API-Key": api_key, "X-User-Id": seed.member_id, "X-Request-ID": request_id},
        )
    assert response.status_code == 500
    row = await _log(request_id)
    assert row.status_code == 500 and row.error_code == "internal_error"
    assert "RuntimeError: quota store exploded" in row.error_traceback


async def test_chat_is_condensed_and_linked(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],  # noqa: F811
    fake_openai: FakeOpenAI,  # noqa: F811
    logging_on: None,
) -> None:
    request_id = rid()
    response = await client.post(
        f"/v1/orgs/{seed.org_id}/chat",
        headers={"X-API-Key": api_key, "X-User-Id": seed.member_id, "X-Request-ID": request_id},
        json={"message": "How much PTO do employees in Germany get?"},
    )
    assert response.status_code == 200
    meta = parse_sse(response.text)[0][1]
    await _wait_for_titles()

    row = await _log(request_id)
    assert row.route == "/v1/orgs/{org_id}/chat" and row.org_id == seed.org_id
    assert str(row.conversation_id) == meta["conversation_id"]
    assert str(row.message_id) == meta["assistant_message_id"]
    assert row.request_body == {"message": "How much PTO do employees in Germany get?"}
    body = row.response_body
    assert body["answer"] == ANSWER
    names = [event["event"] for event in body["events"]]
    assert names == ["meta", "routing", "sources", "delta", "citations", "usage", "done"]
    assert body["events"][3]["count"] > 1
    assert row.error_code is None

    async with engine.connect() as conn:
        operations = (
            (
                await conn.execute(
                    text("SELECT operation FROM llm_usage WHERE request_id = :r"), {"r": request_id}
                )
            )
            .scalars()
            .all()
        )
    # The background title call inherits the request id too.
    assert set(operations) == {"router", "embed_query", "answer", "title"}

    key = {"X-API-Key": api_key}
    detail = (await client.get(f"/v1/logs/{row.id}", headers=key)).json()
    assert detail["user"]["email"] == f"{seed.member_id}@example.test"
    assert detail["org"]["slug"] == seed.org_slug
    assert detail["llm_totals"]["calls"] == 4 and detail["llm_totals"]["cost_usd"] > 0
    assert detail["message"]["status"] == "complete"
    assert detail["message"]["routing"]["jurisdiction"] == "DE"
    assert detail["message"]["sources"][0]["doc_code"] == "SIM-HR-102"

    listed = (await client.get("/v1/logs", headers=key, params={"q": request_id})).json()
    assert [item["id"] for item in listed["items"]] == [str(row.id)]
    item = listed["items"][0]
    assert item["total_tokens"] > 0 and item["org_slug"] == seed.org_slug


async def test_logs_api_needs_key_and_filters(
    client: AsyncClient, api_key: str, seed: Seed, logging_on: None
) -> None:
    assert (await client.get("/v1/logs")).status_code == 401
    assert (await client.get(f"/v1/logs/{uuid.uuid4()}")).status_code == 401

    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    for _ in range(3):
        await client.get("/v1/me", headers={**member, "X-Request-ID": rid()})
    await client.get(f"/v1/conversations/{uuid.uuid4()}", headers={**member, "X-Request-ID": rid()})
    await request_log.drain()

    key = {"X-API-Key": api_key}
    mine = {"user_id": seed.member_id}
    page = (await client.get("/v1/logs", headers=key, params={**mine, "limit": 2})).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    rest = (
        await client.get(
            "/v1/logs", headers=key, params={**mine, "limit": 2, "before": page["next_cursor"]}
        )
    ).json()
    assert len(rest["items"]) == 2 and rest["next_cursor"] is None
    ids = {item["id"] for item in page["items"] + rest["items"]}
    assert len(ids) == 4

    errors = (await client.get("/v1/logs", headers=key, params={**mine, "status": "4xx"})).json()
    assert [item["status_code"] for item in errors["items"]] == [404]
    me_only = (await client.get("/v1/logs", headers=key, params={**mine, "route": "/v1/me"})).json()
    assert len(me_only["items"]) == 3
    posts = (await client.get("/v1/logs", headers=key, params={**mine, "method": "post"})).json()
    assert posts["items"] == []
    assert "/v1/me" in (await client.get("/v1/logs/routes", headers=key)).json()["routes"]

    assert (await client.get("/v1/logs", headers=key, params={"status": "abc"})).status_code == 422
    assert (await client.get(f"/v1/logs/{uuid.uuid4()}", headers=key)).status_code == 404


async def test_viewer_page_is_public_with_strict_csp(client: AsyncClient) -> None:
    response = await client.get("/v1/logs/ui")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    csp = response.headers["content-security-policy"]
    assert "default-src 'none'" in csp and "connect-src 'self'" in csp
    nonce = re.search(r"'nonce-([^']+)'", csp).group(1)
    assert f'<script nonce="{nonce}">' in response.text
    assert "__CSP_NONCE__" not in response.text
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"
    # A fresh nonce per response.
    assert nonce not in (await client.get("/v1/logs/ui")).headers["content-security-policy"]


async def test_prune_deletes_only_old_rows(logging_on: None) -> None:
    old_id, new_id = rid(), rid()
    async with engine.begin() as conn:
        for request_id, age in ((old_id, "40 days"), (new_id, "1 day")):
            await conn.execute(
                text(
                    "INSERT INTO api_request_logs"
                    " (request_id, method, path, status_code, duration_ms, created_at)"
                    f" VALUES (:r, 'GET', '/v1/me', 200, 1, now() - interval '{age}')"
                ),
                {"r": request_id},
            )
    assert await request_logs.prune(30) >= 1
    assert await _log(old_id) is None
    assert await _log(new_id) is not None


def test_condense_sse_merges_deltas() -> None:
    raw = (
        b'event: meta\r\ndata: {"conversation_id": "c"}\r\n\r\n'
        b": ping\r\n\r\n"
        b'event: delta\r\ndata: {"text": "Hel"}\r\n\r\n'
        b'event: delta\r\ndata: {"text": "lo"}\r\n\r\n'
        b'event: error\r\ndata: {"message": "boom"}\r\n\r\n'
    )
    assert request_log.condense_sse(raw) == {
        "answer": "Hello",
        "events": [
            {"event": "meta", "data": {"conversation_id": "c"}},
            {"event": "delta", "count": 2},
            {"event": "error", "data": {"message": "boom"}},
        ],
    }


def test_multipart_is_summarised_with_split_filenames() -> None:
    scope = {
        "type": "http",
        "headers": [(b"content-type", b"multipart/form-data; boundary=x")],
    }
    capture = request_log._Capture(scope)
    part = b'--x\r\nContent-Disposition: form-data; name="files"; filename="SIM-HR-102.pdf"\r\n'
    capture.add_request(b"\x00" * 1000 + part[:50])
    capture.add_request(part[50:] + b"%PDF-1.7" * 10_000)
    capture.add_request(part.replace(b"SIM-HR-102", b"SIM-IT-001"))
    body = capture.request_body()
    assert body["multipart"] is True and body["filenames"] == ["SIM-HR-102.pdf", "SIM-IT-001.pdf"]
    assert body["bytes"] == capture.request_size > 80_000
    assert capture.request_chunks == []  # the file bytes themselves are never kept
