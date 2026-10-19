"""Eval hooks (Phase E1): tagging, invisibility, overrides, eval-mode SSE, the eval endpoints.

Chat runs against the fake OpenAI from test_chat_stream; the seed's platform admin plays the
harness's service account.
"""

import uuid
from typing import Any

from httpx import AsyncClient

from app.services.eval import prompt_hashes
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

# The user-facing payloads, frozen: eval mode must not change them.
ROUTING_KEYS = {
    "departments",
    "jurisdiction",
    "standalone_query",
    "sub_queries",
    "parts",
    "bypassed",
    "document_ids",
}
SOURCE_PREVIEW_KEYS = {
    "n",
    "document_id",
    "doc_code",
    "title",
    "section_number",
    "section_title",
    "page_start",
    "page_end",
    "jurisdiction",
}
USAGE_KEYS = {"input_tokens", "cached_tokens", "output_tokens", "cost_usd", "latency_ms", "ttft_ms"}


def headers(api_key: str, user_id: str, run: str | None = None, case: str | None = None) -> dict:
    result = {"X-API-Key": api_key, "X-User-Id": user_id}
    if run:
        result["X-Eval-Run-Id"] = run
        result["X-Request-ID"] = f"eval.{run[:8]}.{case or 'none'}.1"
    if case:
        result["X-Eval-Case-Id"] = case
    return result


def run_id() -> str:
    return f"test-run-{uuid.uuid4().hex[:12]}"


async def chat(client: AsyncClient, seed: Seed, hdrs: dict, **body: Any) -> Any:
    return await client.post(
        f"/v1/orgs/{seed.org_id}/chat", headers=hdrs, json={"message": QUESTION, **body}
    )


def events_of(response: Any) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    events = parse_sse(response.text)
    assert events[-1][0] == "done", events[-1]
    return {name: payload for name, payload in events if name != "delta"}


async def quota_of(client: AsyncClient, api_key: str, user_id: str) -> tuple[int, int]:
    status = (await client.get("/v1/me/quota", headers=headers(api_key, user_id))).json()
    return status["messages_used"], status["tokens_used"]


async def test_eval_chat_is_hidden_and_unmetered(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    admin = headers(api_key, seed.admin_id)
    run = run_id()
    tagged = headers(api_key, seed.admin_id, run, "case-1")
    quota_before = await quota_of(client, api_key, seed.admin_id)

    data = events_of(await chat(client, seed, tagged))
    conversation_id = data["meta"]["conversation_id"]
    answer_id = data["meta"]["assistant_message_id"]

    # Eval-mode payloads: routing is a superset, sources carry text and scores, usage the calls.
    routing = data["routing"]
    assert ROUTING_KEYS < set(routing)
    assert routing["needs_clarification"] is False and "clarifying_question" in routing
    source = data["sources"][0]
    assert source["text"] and source["chunk_id"] and source["section_path"]
    assert {"bm25_rank", "vector_rank", "rrf", "score", "part"} <= set(source["scores"])
    assert {"content_type", "department", "owner"} <= set(source)
    usage = data["usage"]
    assert [c["operation"] for c in usage["by_operation"]] == ["router", "embed_query", "answer"]
    assert sum(c["input_tokens"] for c in usage["by_operation"]) == usage["input_tokens"]
    assert usage["retrieval"]["sources"][0]["chunk_id"] == source["chunk_id"]

    (conversation,) = await _rows(
        "SELECT is_eval, eval_run_id, eval_case_id, title FROM conversations WHERE id = :c",
        c=conversation_id,
    )
    assert tuple(conversation) == (True, run, "case-1", "[eval] case-1")
    await _wait_for_titles()
    usage_rows = await _rows(
        "SELECT operation, eval_run_id, eval_case_id, request_id FROM llm_usage"
        " WHERE conversation_id = :c",
        c=conversation_id,
    )
    assert sorted(r.operation for r in usage_rows) == [
        "answer",
        "embed_query",
        "router",
    ]  # no title
    assert {(r.eval_run_id, r.eval_case_id) for r in usage_rows} == {(run, "case-1")}
    assert {r.request_id for r in usage_rows} == {tagged["X-Request-ID"]}
    assert await quota_of(client, api_key, seed.admin_id) == quota_before

    # Invisible: conversation list, bookmarks, my-analytics, org analytics, admin org overview.
    bookmarked = await client.put(f"/v1/messages/{answer_id}/bookmark", headers=admin)
    assert bookmarked.status_code == 200
    listing = (await client.get(f"/v1/orgs/{seed.org_id}/conversations", headers=admin)).json()
    assert listing["conversations"] == []
    bookmarks = (await client.get(f"/v1/orgs/{seed.org_id}/bookmarks", headers=admin)).json()
    assert bookmarks == {"bookmarks": []}
    mine = (await client.get(f"/v1/orgs/{seed.org_id}/me/analytics", headers=admin)).json()
    t = mine["totals"]
    assert (t["questions"], t["conversations_total"], t["total_tokens"], t["bookmarks"]) == (
        0,
        0,
        0,
        0,
    )
    stats = (await client.get(f"/v1/analytics?org_id={seed.org_id}", headers=admin)).json()
    assert (stats["totals"]["requests"], stats["totals"]["messages"]) == (0, 0)
    assert stats["totals"]["cost_usd"] == 0
    orgs = (await client.get("/v1/admin/orgs", headers=admin)).json()["orgs"]
    (org,) = [o for o in orgs if o["id"] == seed.org_id]
    assert (org["conversations"], org["cost_30d_usd"]) == (0, 0)

    # An eval conversation continues only as eval, and a normal one never as eval.
    follow_up = {"conversation_id": conversation_id, "message": "And in France?"}
    url = f"/v1/orgs/{seed.org_id}/chat"
    assert (await client.post(url, headers=admin, json=follow_up)).status_code == 404
    assert (await client.post(url, headers=tagged, json=follow_up)).status_code == 200
    normal = events_of(await chat(client, seed, admin))
    as_eval = {"conversation_id": normal["meta"]["conversation_id"], "message": "x"}
    assert (await client.post(url, headers=tagged, json=as_eval)).status_code == 404

    # Per-run usage reconciles with the rows.
    run_usage = (await client.get(f"/v1/admin/eval-runs/{run}/usage", headers=admin)).json()
    assert run_usage["totals"]["calls"] == 6  # 2 turns × router, embed, answer
    (case,) = run_usage["by_case"]
    assert case["eval_case_id"] == "case-1" and case["calls"] == 6 and case["cost_usd"] > 0
    assert {row["operation"] for row in run_usage["by_operation"]} == {
        "router",
        "embed_query",
        "answer",
    }


async def test_eval_authorization(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    member = headers(api_key, seed.member_id)
    admin = headers(api_key, seed.admin_id)
    overrides = {"overrides": {"top_k": 3}}

    for hdrs in (member, admin):  # overrides need the eval headers, whoever asks
        response = await chat(client, seed, hdrs, **overrides)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "overrides_require_eval"

    response = await chat(client, seed, headers(api_key, seed.member_id, run_id(), "c1"))
    assert response.status_code == 403 and response.json()["error"]["code"] == "eval_forbidden"

    for bad in (
        {**admin, "X-Eval-Run-Id": "run:1"},
        {**admin, "X-Eval-Run-Id": "ok", "X-Eval-Case-Id": "a b"},
        {**admin, "X-Eval-Case-Id": "only-case"},
        {**admin, "X-Eval-Run-Id": "x" * 101},
    ):
        response = await chat(client, seed, bad)
        assert response.status_code == 422, bad
        assert response.json()["error"]["code"] == "invalid_eval_header"

    tagged = headers(api_key, seed.admin_id, run_id(), "c1")
    for invalid in ({"top_k": 0}, {"chat_model": "nope"}, {"retrieval_mode": "x"}, {"z": 1}):
        response = await chat(client, seed, tagged, overrides=invalid)
        assert response.status_code == 422, invalid

    # Every eval endpoint is admin-only.
    hr = corpus["hr"]
    for method, path, body in (
        ("POST", f"/v1/orgs/{seed.org_id}/retrieve", {"query": QUESTION}),
        ("GET", f"/v1/orgs/{seed.org_id}/documents/{hr}/chunks", None),
        ("GET", "/v1/admin/eval/info", None),
        ("GET", "/v1/admin/eval-runs/r1/usage", None),
        ("DELETE", "/v1/admin/eval-runs/r1/conversations", None),
    ):
        response = await client.request(method, path, headers=member, json=body)
        assert response.status_code == 403, path
    assert fake_openai.calls == []  # nothing reached the model


async def test_overrides_and_payloads(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    # A normal chat keeps the user-facing payloads exactly.
    data = events_of(await chat(client, seed, headers(api_key, seed.member_id)))
    assert data["routing"] == {
        "departments": ["HR"],
        "jurisdiction": "DE",
        "standalone_query": "How much annual leave do employees in Germany get?",
        "sub_queries": [],
        "parts": [],
        "bypassed": False,
        "document_ids": [],
    }
    assert all(set(s) == SOURCE_PREVIEW_KEYS for s in data["sources"])
    assert set(data["usage"]) == USAGE_KEYS
    hybrid_ids = [s["document_id"] for s in data["sources"]]

    tagged = headers(api_key, seed.admin_id, run_id(), "overrides")
    fake_openai.calls.clear()
    data = events_of(
        await chat(
            client,
            seed,
            tagged,
            overrides={
                "top_k": 1,
                "retrieval_mode": "bm25",
                "chat_model": "gpt-5.4-mini",
                "router_model": "gpt-5.4-nano",
                "chat_service_tier": "flex",
            },
        )
    )
    (source,) = data["sources"]  # top_k=1
    assert source["scores"]["vector_rank"] is None and source["scores"]["bm25_rank"] == 1
    assert {item["method"] for item in data["usage"]["retrieval"]["lists"]} == {"bm25"}
    router_call, stream_call = fake_openai.calls[0], fake_openai.calls[-1]
    assert (router_call["model"], router_call["service_tier"]) == ("gpt-5.4-nano", "flex")
    assert (stream_call["model"], stream_call["service_tier"]) == ("gpt-5.4-mini", "flex")
    assert {c["tier_actual"] for c in data["usage"]["by_operation"] if c["tier_actual"]} == {"flex"}

    data = events_of(
        await chat(client, seed, tagged, overrides={"top_k": 3, "include_source_text": False})
    )
    assert 1 <= len(data["sources"]) <= 3
    assert all("text" not in s and s["chunk_id"] for s in data["sources"])
    assert [s["document_id"] for s in data["sources"]] == hybrid_ids[: len(data["sources"])]


async def test_retrieve_endpoint(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    run = run_id()
    tagged = headers(api_key, seed.admin_id, run, "retrieve-1")
    url = f"/v1/orgs/{seed.org_id}/retrieve"
    quota_before = await quota_of(client, api_key, seed.admin_id)

    response = await client.post(
        url, headers=tagged, json={"query": QUESTION, "modes": ["bm25", "vector", "hybrid"]}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [c.get("text", {}).get("format", {}).get("name") for c in fake_openai.calls] == [
        "route",
        None,
    ]
    assert "embed" in fake_openai.calls[1]  # one router call, one embed call for 3 modes
    assert set(body["results"]) == {"bm25", "vector", "hybrid"}
    for mode, result in body["results"].items():
        assert result["sources"] and all(s["text"] for s in result["sources"])
        methods = {item["method"] for item in result["retrieval"]["lists"]}
        assert methods == ({"bm25", "vector"} if mode == "hybrid" else {mode})
    assert {s["doc_code"] for s in body["results"]["hybrid"]["sources"]} == {"SIM-HR-102"}
    assert body["routing"]["departments"] == ["HR"] and body["queries"] == [
        "How much annual leave do employees in Germany get?"
    ]
    assert [c["operation"] for c in body["usage"]["by_operation"]] == ["router", "embed_query"]
    assert body["timings_ms"]["total"] >= 0

    rows = await _rows(
        "SELECT operation, eval_case_id, conversation_id FROM llm_usage WHERE eval_run_id = :r",
        r=run,
    )
    assert sorted(r.operation for r in rows) == ["embed_query", "router"]
    assert {(r.eval_case_id, r.conversation_id) for r in rows} == {("retrieve-1", None)}
    assert await quota_of(client, api_key, seed.admin_id) == quota_before
    assert await _rows("SELECT 1 FROM conversations WHERE org_id = :o", o=seed.org_id) == []

    # BM25 only: no embedding. Scoped: no routing call (no history), only that document.
    fake_openai.calls.clear()
    scoped = await client.post(
        url,
        headers=tagged,
        json={"query": QUESTION, "modes": ["bm25"], "document_ids": [str(corpus["it"])]},
    )
    assert scoped.status_code == 200, scoped.text
    assert fake_openai.calls == []
    assert scoped.json()["routing"]["bypassed"] is True
    assert {s["doc_code"] for s in scoped.json()["results"]["bm25"]["sources"]} == {"SIM-IT-001"}

    duplicate = await client.post(url, headers=tagged, json={"query": "x", "modes": ["bm25"] * 2})
    assert duplicate.status_code == 422


async def test_chunks_info_and_cleanup(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    admin = headers(api_key, seed.admin_id)
    url = f"/v1/orgs/{seed.org_id}/documents/{corpus['hr']}/chunks"
    page = (await client.get(url, headers=admin)).json()
    assert page["document"]["doc_code"] == "SIM-HR-102" and page["total"] == 3
    assert [c["chunk_index"] for c in page["chunks"]] == [0, 1, 2]
    assert page["chunks"][0]["section_number"] == "5.2" and page["chunks"][0]["page_start"] == 15
    second = (await client.get(url, headers=admin, params={"offset": 1, "limit": 1})).json()
    assert [c["chunk_index"] for c in second["chunks"]] == [1] and second["total"] == 3
    assert (await client.get(url, headers=admin, params={"limit": 501})).status_code == 422
    missing = f"/v1/orgs/{seed.org_id}/documents/{uuid.uuid4()}/chunks"
    assert (await client.get(missing, headers=admin)).status_code == 404

    info = (await client.get("/v1/admin/eval/info", headers=admin)).json()
    assert info["version"] and "gpt-6-luna" in info["chat_models"]
    assert info["prompt_hashes"] == prompt_hashes()
    assert set(info["prompt_hashes"]) == {
        "router",
        "rewrite",
        "answer_rules",
        "specialists",
        "title",
    }
    assert info["retrieval"]["RRF_K"] == 60 and info["retrieval"]["METHOD_WEIGHTS"]["bm25"] == 0.6
    assert len(info["pricing_sha256"]) == 64 and info["defaults"]["top_k"] == 8

    run_a, run_b = run_id(), run_id()
    for run in (run_a, run_a, run_b):
        events_of(await chat(client, seed, headers(api_key, seed.admin_id, run, "c")))
    events_of(await chat(client, seed, admin))  # a normal conversation
    deleted = await client.delete(f"/v1/admin/eval-runs/{run_a}/conversations", headers=admin)
    assert deleted.json() == {"deleted": 2}
    left = await _rows(
        "SELECT is_eval, eval_run_id FROM conversations WHERE org_id = :o", o=seed.org_id
    )
    assert sorted((r.is_eval, r.eval_run_id or "") for r in left) == [(False, ""), (True, run_b)]
    # Usage rows outlive the conversations, so the run's cost stays reconcilable.
    usage = (await client.get(f"/v1/admin/eval-runs/{run_a}/usage", headers=admin)).json()
    assert usage["totals"]["calls"] == 6
    bad = await client.get("/v1/admin/eval-runs/a:b/usage", headers=admin)
    assert bad.status_code == 422
