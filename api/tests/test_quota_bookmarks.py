"""Monthly quota (limits, enforcement, admin control), bookmarks and the personal analytics.

Chat runs against the fake OpenAI from test_chat_stream, so token counts are deterministic.
"""

import uuid
from datetime import date
from typing import Any

from httpx import AsyncClient
from sqlalchemy import text

from app.core.db import engine
from app.services import quota
from tests.conftest import Seed
from tests.test_chat_stream import (  # noqa: F401  (fixtures)
    FakeOpenAI,
    _rows,
    _wait_for_titles,
    corpus,
    fake_openai,
    parse_sse,
)

QUESTION = "How much PTO do employees in Germany get?"


def headers(api_key: str, user_id: str) -> dict[str, str]:
    return {"X-API-Key": api_key, "X-User-Id": user_id}


async def ask(client: AsyncClient, api_key: str, seed: Seed, user_id: str | None = None) -> Any:
    return await client.post(
        f"/v1/orgs/{seed.org_id}/chat",
        headers=headers(api_key, user_id or seed.member_id),
        json={"message": QUESTION},
    )


async def set_quota(client: AsyncClient, api_key: str, seed: Seed, **limits: int) -> Any:
    return await client.put(
        f"/v1/admin/users/{seed.member_id}/quota",
        headers=headers(api_key, seed.admin_id),
        json=limits,
    )


def test_period_helpers() -> None:
    assert quota.next_period(date(2026, 10, 18)) == date(2026, 11, 1)
    assert quota.next_period(date(2026, 12, 1)) == date(2027, 1, 1)


async def test_default_quota_and_admin_is_unlimited(
    client: AsyncClient, api_key: str, seed: Seed
) -> None:
    mine = (await client.get("/v1/me/quota", headers=headers(api_key, seed.member_id))).json()
    assert (mine["message_limit"], mine["token_limit"]) == (25, 100_000)
    assert (mine["messages_used"], mine["tokens_used"]) == (0, 0)
    assert mine["is_custom"] is False and mine["unlimited"] is False and mine["exhausted"] is None
    assert mine["resets_on"] == str(quota.next_period(quota.current_period()))

    admin = (await client.get("/v1/me/quota", headers=headers(api_key, seed.admin_id))).json()
    assert admin["unlimited"] is True and admin["exhausted"] is None


async def test_messages_are_counted_and_refused_at_the_limit(
    client: AsyncClient, api_key: str, seed: Seed, corpus: dict[str, uuid.UUID], fake_openai: Any
) -> None:
    response = await set_quota(client, api_key, seed, message_limit=2, token_limit=1_000_000)
    assert response.status_code == 200, response.text
    assert response.json()["is_custom"] is True

    for _ in range(2):
        assert (await ask(client, api_key, seed)).status_code == 200
    await _wait_for_titles()

    status = (await client.get("/v1/me/quota", headers=headers(api_key, seed.member_id))).json()
    assert status["messages_used"] == 2 and status["exhausted"] == "messages"
    # router 120+40, embed 7, answer 900+60 per message, plus the title call for new chats
    assert status["tokens_used"] >= 2 * (120 + 40 + 7 + 900 + 60)

    refused = await ask(client, api_key, seed)
    assert refused.status_code == 429
    error = refused.json()["error"]
    assert error["code"] == "quota_exceeded"
    assert "2 messages" in error["message"] and "renews on" in error["message"]
    assert error["details"]["exhausted"] == "messages"
    # Nothing was stored for the refused question.
    rows = await _rows(
        "SELECT count(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id"
        " WHERE c.user_id = :u AND m.role = 'user'",
        u=seed.member_id,
    )
    assert rows[0].n == 2

    # Raising the limit takes effect immediately; resetting returns to the defaults.
    await set_quota(client, api_key, seed, message_limit=3, token_limit=1_000_000)
    assert (await ask(client, api_key, seed)).status_code == 200
    await _wait_for_titles()
    reset = await client.delete(
        f"/v1/admin/users/{seed.member_id}/quota", headers=headers(api_key, seed.admin_id)
    )
    assert reset.json()["message_limit"] == 25 and reset.json()["is_custom"] is False


async def test_token_limit_blocks_the_next_message(
    client: AsyncClient, api_key: str, seed: Seed, corpus: dict[str, uuid.UUID], fake_openai: Any
) -> None:
    await set_quota(client, api_key, seed, message_limit=10, token_limit=500)
    # Under the limit when it starts, so the first turn runs to the end ...
    assert (await ask(client, api_key, seed)).status_code == 200
    await _wait_for_titles()
    # ... and has pushed the account over it.
    refused = await ask(client, api_key, seed)
    assert refused.status_code == 429
    assert refused.json()["error"]["details"]["exhausted"] == "tokens"
    assert "tokens" in refused.json()["error"]["message"]


async def test_admin_is_not_limited_and_zero_blocks_everything(
    client: AsyncClient, api_key: str, seed: Seed, corpus: dict[str, uuid.UUID], fake_openai: Any
) -> None:
    await client.put(
        f"/v1/admin/users/{seed.admin_id}/quota",
        headers=headers(api_key, seed.admin_id),
        json={"message_limit": 0, "token_limit": 0},
    )
    assert (await ask(client, api_key, seed, seed.admin_id)).status_code == 200
    await _wait_for_titles()

    await set_quota(client, api_key, seed, message_limit=0, token_limit=100)
    assert (await ask(client, api_key, seed)).status_code == 429


async def test_a_new_month_starts_from_zero(client: AsyncClient, api_key: str, seed: Seed) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO quota_usage (user_id, period_start, messages, tokens)"
                " VALUES (:u, '2020-01-01', 99, 999999)"
            ),
            {"u": seed.member_id},
        )
    status = (await client.get("/v1/me/quota", headers=headers(api_key, seed.member_id))).json()
    assert (status["messages_used"], status["tokens_used"], status["exhausted"]) == (0, 0, None)


async def test_quota_admin_routes_are_admin_only(
    client: AsyncClient, api_key: str, seed: Seed
) -> None:
    member = headers(api_key, seed.member_id)
    url = f"/v1/admin/users/{seed.member_id}/quota"
    body = {"message_limit": 1000, "token_limit": 1}
    assert (await client.put(url, headers=member, json=body)).status_code == 403
    assert (await client.delete(url, headers=member)).status_code == 403
    assert (await client.get("/v1/admin/quotas", headers=member)).status_code == 403

    admin = headers(api_key, seed.admin_id)
    bad = await client.put(url, headers=admin, json={"message_limit": -1, "token_limit": 1})
    assert bad.status_code == 422
    missing = await client.put("/v1/admin/users/nobody/quota", headers=admin, json=body)
    assert missing.status_code == 404

    listing = await client.get(
        "/v1/admin/quotas",
        headers=admin,
        params=[("user_id", seed.member_id), ("user_id", seed.admin_id), ("user_id", "nobody")],
    )
    data = listing.json()
    assert [q["user_id"] for q in data["quotas"]] == [seed.member_id, seed.admin_id]
    assert data["defaults"] == {"message_limit": 25, "token_limit": 100_000}


async def test_bookmarks(
    client: AsyncClient, api_key: str, seed: Seed, corpus: dict[str, uuid.UUID], fake_openai: Any
) -> None:
    member = headers(api_key, seed.member_id)
    events = parse_sse((await ask(client, api_key, seed)).text)
    meta = next(payload for name, payload in events if name == "meta")
    answer_id, question_id = meta["assistant_message_id"], meta["user_message_id"]
    await _wait_for_titles()

    listing = f"/v1/orgs/{seed.org_id}/bookmarks"
    assert (await client.get(listing, headers=member)).json() == {"bookmarks": []}

    added = await client.put(f"/v1/messages/{answer_id}/bookmark", headers=member)
    assert added.status_code == 200 and added.json()["bookmarked_at"] is not None
    again = await client.put(f"/v1/messages/{answer_id}/bookmark", headers=member)
    assert again.json()["bookmarked_at"] == added.json()["bookmarked_at"]  # idempotent

    (item,) = (await client.get(listing, headers=member)).json()["bookmarks"]
    assert item["message_id"] == answer_id and item["conversation_id"] == meta["conversation_id"]
    assert item["question"] == QUESTION
    assert item["doc_codes"] == ["SIM-HR-102"]
    assert "[1]" not in item["answer_excerpt"] and item["answer_excerpt"].startswith("Employees")
    assert item["conversation_title"]

    detail = (
        await client.get(f"/v1/conversations/{meta['conversation_id']}", headers=member)
    ).json()
    flags = {m["id"]: m["bookmarked_at"] is not None for m in detail["messages"]}
    assert flags == {question_id: False, answer_id: True}

    # Only answers, and only by their owner.
    assert (
        await client.put(f"/v1/messages/{question_id}/bookmark", headers=member)
    ).status_code == 422
    outsider = headers(api_key, seed.outsider_id)
    assert (
        await client.put(f"/v1/messages/{answer_id}/bookmark", headers=outsider)
    ).status_code == 404
    assert (await client.get(listing, headers=outsider)).status_code == 404  # not in the org
    assert (await client.get(listing, headers=headers(api_key, seed.admin_id))).json() == {
        "bookmarks": []
    }

    removed = await client.delete(f"/v1/messages/{answer_id}/bookmark", headers=member)
    assert removed.json()["bookmarked_at"] is None
    assert (await client.get(listing, headers=member)).json() == {"bookmarks": []}


async def test_my_analytics(
    client: AsyncClient, api_key: str, seed: Seed, corpus: dict[str, uuid.UUID], fake_openai: Any
) -> None:
    member = headers(api_key, seed.member_id)
    events = parse_sse((await ask(client, api_key, seed)).text)
    meta = next(payload for name, payload in events if name == "meta")
    await _wait_for_titles()
    await client.post(
        f"/v1/messages/{meta['assistant_message_id']}/feedback", headers=member, json={"value": 1}
    )
    await client.put(f"/v1/messages/{meta['assistant_message_id']}/bookmark", headers=member)

    url = f"/v1/orgs/{seed.org_id}/me/analytics"
    response = await client.get(url, headers=member)
    assert response.status_code == 200, response.text
    data = response.json()
    t = data["totals"]
    assert (t["conversations"], t["questions"], t["answers"]) == (1, 1, 1)
    assert (t["up"], t["down"], t["bookmarks"]) == (1, 0, 1)
    assert t["input_tokens"] >= 120 + 7 + 900 and t["output_tokens"] >= 40 + 60
    assert t["total_tokens"] == t["input_tokens"] + t["output_tokens"]
    assert t["p50_latency_ms"] is not None and t["p50_ttft_ms"] is not None
    assert len(data["timeseries"]) == 30
    assert sum(p["questions"] for p in data["timeseries"]) == 1
    assert data["quota"]["messages_used"] == 1 and "cost_usd" not in t

    # Nobody else's activity leaks in.
    other = (await client.get(url, headers=headers(api_key, seed.admin_id))).json()["totals"]
    assert (other["questions"], other["conversations"], other["total_tokens"]) == (0, 0, 0)
    assert (await client.get(url, headers=headers(api_key, seed.outsider_id))).status_code == 404
    bad = await client.get(url, headers=member, params={"from": "2026-02-01", "to": "2026-01-01"})
    assert bad.status_code == 422
