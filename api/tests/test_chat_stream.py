"""Chat SSE, conversations, feedback and settings against the dev DB.

OpenAI is replaced at the client level (`llm.client.get_client`), so routing, embedding,
streaming and metering all run for real and write `llm_usage` rows.
"""

import asyncio
import contextlib
import hashlib
import json
import uuid
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.agents import catalog
from app.core.db import engine, session_scope
from app.ingestion.chunker import ChunkDraft
from app.ingestion.indexer import write_index
from app.llm import client as llm_client
from app.models.document import Document
from app.services import chat as chat_service
from app.services.chat import ChatTurn
from app.services.org_settings import default_settings
from tests.conftest import Seed

ANSWER = (
    "Employees in Germany get 30 working days of annual leave [1]. "
    "Employees with severe disabilities get 5 more [2][1]. Not a source [9]."
)


def _usage(input_tokens: int = 120, cached: int = 20, output: int = 40) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=input_tokens,
        input_tokens_details=SimpleNamespace(cached_tokens=cached),
        output_tokens=output,
        output_tokens_details=SimpleNamespace(reasoning_tokens=5),
    )


class FakeStream:
    def __init__(self, text: str, tier: str, delay: float = 0.0) -> None:
        self.pieces = [text[i : i + 12] for i in range(0, len(text), 12)]
        self.tier, self.delay, self.closed = tier, delay, False

    async def __aiter__(self) -> AsyncIterator[Any]:
        yield SimpleNamespace(type="response.created")
        for piece in self.pieces:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield SimpleNamespace(type="response.output_text.delta", delta=piece)
        yield SimpleNamespace(
            type="response.completed",
            response=SimpleNamespace(usage=_usage(900, 0, 60), service_tier=self.tier),
        )

    async def close(self) -> None:
        self.closed = True


class FakeOpenAI:
    """Just enough of AsyncOpenAI for respond / stream_respond / embed."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.route: dict[str, Any] = {
            "departments": ["HR"],
            "jurisdiction": "DE",
            "standalone_query": "How much annual leave do employees in Germany get?",
            "sub_queries": [],
            "needs_clarification": False,
            "clarifying_question": None,
        }
        self.answer = ANSWER
        self.stream_delay = 0.0
        self.responses = SimpleNamespace(create=self._create)
        self.embeddings = SimpleNamespace(create=self._embed)

    def with_options(self, **_: Any) -> "FakeOpenAI":
        return self

    async def _create(self, **params: Any) -> Any:
        self.calls.append(params)
        tier = "flex" if params.get("service_tier") == "flex" else "default"
        if params.get("stream"):
            return FakeStream(self.answer, tier, self.stream_delay)
        name = params["text"]["format"]["name"]
        payload = {
            "route": self.route,
            "rewrite": {"standalone_query": "Can I use ChatGPT for work in Germany?"},
            "conversation_title": {"title": "German annual leave entitlement."},
        }[name]
        return SimpleNamespace(output_text=json.dumps(payload), usage=_usage(), service_tier=tier)

    async def _embed(self, *, model: str, input: list[str]) -> Any:
        self.calls.append({"embed": input})
        return SimpleNamespace(
            data=[SimpleNamespace(index=i, embedding=_vector(t)) for i, t in enumerate(input)],
            usage=SimpleNamespace(prompt_tokens=7 * len(input)),
        )


def _vector(value: str) -> list[float]:
    seed = hashlib.sha256(value.encode()).digest()
    return [(seed[i % 32] + 1) / 256 for i in range(1536)]


@pytest.fixture
def fake_openai(monkeypatch: pytest.MonkeyPatch) -> FakeOpenAI:
    fake = FakeOpenAI()
    monkeypatch.setattr(llm_client, "get_client", lambda: fake)
    return fake


def _draft(index: int, body: str, number: str, title: str, page: int) -> ChunkDraft:
    return ChunkDraft(
        chunk_index=index,
        text=body,
        embed_text=f"[SIM-HR-102 · Germany HR Manual | {number} {title}]\n{body}",
        section_path=[f"{number} {title}"],
        section_number=number,
        section_title=title,
        page_start=page,
        page_end=page,
        content_type="prose",
        token_count=40,
        cross_refs=[],
    )


async def _index_document(
    org_id: str, code: str, title: str, department: str, juris: str, drafts: list[ChunkDraft]
) -> uuid.UUID:
    document_id = uuid.uuid4()
    async with session_scope() as session:
        session.add(
            Document(
                id=document_id,
                org_id=org_id,
                title=title,
                file_key=f"test/{document_id}.pdf",
                sha256=uuid.uuid4().hex,
                status="processing",
            )
        )
        await session.flush()
        await write_index(
            session,
            document_id=document_id,
            org_id=org_id,
            drafts=drafts,
            embeddings=[_vector(d.embed_text) for d in drafts],
            document_fields={
                "doc_code": code,
                "title": title,
                "department": department,
                "jurisdiction": juris,
                "doc_type": "policy_manual",
                "owner": "Chief People Officer" if department == "HR" else "Head of IT",
            },
        )
    catalog.invalidate(org_id)
    return document_id


@pytest.fixture
async def corpus(seed: Seed) -> AsyncIterator[dict[str, uuid.UUID]]:
    hr = await _index_document(
        seed.org_id,
        "SIM-HR-102",
        "Germany HR Manual",
        "HR",
        "DE",
        [
            _draft(
                0,
                "5.2 Annual Leave\n\nEmployees receive 30 working days of paid annual leave "
                "per calendar year on a five-day week.",
                "5.2",
                "Annual Leave",
                15,
            ),
            _draft(
                1,
                "Employees with severe disabilities receive 5 additional days of annual leave.",
                "5.2",
                "Annual Leave",
                16,
            ),
            _draft(2, "5.3 Sick Leave\n\nSick pay continues for six weeks.", "5.3", "Sick", 16),
        ],
    )
    it = await _index_document(
        seed.org_id,
        "SIM-IT-001",
        "IT Policy Manual",
        "IT",
        "GLOBAL",
        [
            _draft(
                0,
                "4.5 Approved AI Tools\n\nOnly AI tools on the approved list may be used.",
                "4.5",
                "Approved AI Tools",
                35,
            )
        ],
    )
    try:
        yield {"hr": hr, "it": it}
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM llm_usage WHERE org_id = :o"), {"o": seed.org_id})
        catalog.invalidate(seed.org_id)


def parse_sse(body: str) -> list[tuple[str, Any]]:
    events: list[tuple[str, Any]] = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        name, data = None, []
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if name:
            events.append((name, json.loads("\n".join(data)) if data else None))
    return events


async def _rows(sql: str, **params: Any) -> list[Any]:
    async with engine.connect() as conn:
        return list((await conn.execute(text(sql), params)).all())


async def _wait_for_titles() -> None:
    await asyncio.gather(*list(chat_service.background_tasks), return_exceptions=True)


async def test_chat_streams_events_and_persists(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    url = f"/v1/orgs/{seed.org_id}/chat"

    response = await client.post(
        url, headers=member, json={"message": "How much PTO do employees in Germany get?"}
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names[:3] == ["meta", "routing", "sources"]
    assert names[-3:] == ["citations", "usage", "done"]
    assert set(names[3:-3]) == {"delta"}

    data = dict((name, payload) for name, payload in events if name != "delta")
    meta, routing, sources = data["meta"], data["routing"], data["sources"]
    assert routing["departments"] == ["HR"] and routing["jurisdiction"] == "DE"
    assert routing["bypassed"] is False
    assert sources[0]["doc_code"] == "SIM-HR-102" and sources[0]["n"] == 1
    assert {s["doc_code"] for s in sources} == {"SIM-HR-102"}  # HR filter
    answer = "".join(p["text"] for name, p in events if name == "delta")
    assert answer == ANSWER
    citations = data["citations"]
    assert [c["n"] for c in citations] == [1, 2]  # [9] dropped, first-cited order
    assert citations[0]["page_start"] == sources[0]["page_start"]
    usage = data["usage"]
    # router (120 in) + embed (7) + answer (900 in)
    assert usage["input_tokens"] == 120 + 7 + 900
    assert usage["output_tokens"] == 40 + 60
    assert usage["cost_usd"] > 0 and usage["ttft_ms"] is not None

    # The OpenAI calls: router (chat tier = standard → default), one embed for the queries,
    # the streamed answer with the sources block.
    router_call = fake_openai.calls[0]
    assert router_call["service_tier"] == "default"
    assert "SIM-HR-102" in router_call["instructions"]  # the catalog
    assert router_call["input"][-1]["content"].endswith("How much PTO do employees in Germany get?")
    stream_call = next(c for c in fake_openai.calls if c.get("stream"))
    assert (
        "[1] SIM-HR-102 · Germany HR Manual (DE) · §5.2 Annual Leave · p.1"
        in (stream_call["input"][-1]["content"])
    )
    assert "Country manuals override" in stream_call["instructions"]

    conversation_id = meta["conversation_id"]
    messages = await _rows(
        "SELECT id, role, content, status, citations, sources, routing, retrieval FROM messages"
        " WHERE conversation_id = :c ORDER BY created_at, role DESC",
        c=conversation_id,
    )
    assert [(m.role, m.status) for m in messages] == [
        ("user", "complete"),
        ("assistant", "complete"),
    ]
    assistant = messages[1]
    assert str(assistant.id) == meta["assistant_message_id"]
    assert assistant.content == ANSWER
    assert [c["n"] for c in assistant.citations] == [1, 2]
    assert assistant.citations[0]["highlight_text"] == assistant.sources[0]["text"]
    assert assistant.sources[0]["chunk_id"] == assistant.retrieval["sources"][0]["chunk_id"]
    assert assistant.routing["standalone_query"].startswith("How much annual leave")
    assert assistant.retrieval["sources"][0]["rrf"] > 0
    assert {item["method"] for item in assistant.retrieval["lists"]} == {"bm25", "vector"}

    usage_rows = await _rows(
        "SELECT operation, service_tier_requested, service_tier_actual, cost_usd, ttft_ms"
        " FROM llm_usage WHERE message_id = :m ORDER BY operation",
        m=assistant.id,
    )
    assert [r.operation for r in usage_rows] == ["answer", "embed_query", "router"]
    answer_row = usage_rows[0]
    assert (answer_row.service_tier_requested, answer_row.service_tier_actual) == (
        "default",
        "default",
    )
    assert answer_row.ttft_ms is not None and answer_row.cost_usd > 0

    # A title is generated in the background (background tier = flex) and trimmed to 6 words.
    await _wait_for_titles()
    title = await _rows("SELECT title FROM conversations WHERE id = :c", c=conversation_id)
    assert title[0].title == "German annual leave entitlement"
    title_rows = await _rows(
        "SELECT service_tier_requested FROM llm_usage WHERE conversation_id = :c"
        " AND operation = 'title'",
        c=conversation_id,
    )
    assert [r.service_tier_requested for r in title_rows] == ["flex"]

    # A scoped follow-up in the same conversation: no routing, the query is rewritten using
    # the history, and only the chosen document is searched and cited.
    fake_openai.calls.clear()
    fake_openai.answer = "Only approved AI tools may be used [1]."
    response = await client.post(
        url,
        headers=member,
        json={
            "conversation_id": conversation_id,
            "message": "Can I use ChatGPT then?",
            "document_ids": [str(corpus["it"])],
        },
    )
    events = parse_sse(response.text)
    data = dict((name, payload) for name, payload in events if name != "delta")
    assert data["routing"]["bypassed"] is True
    assert data["routing"]["standalone_query"] == "Can I use ChatGPT for work in Germany?"
    assert {s["doc_code"] for s in data["sources"]} == {"SIM-IT-001"}
    assert [c["doc_code"] for c in data["citations"]] == ["SIM-IT-001"]
    rewrite_call = fake_openai.calls[0]
    assert rewrite_call["text"]["format"]["name"] == "rewrite"
    assert [m["role"] for m in rewrite_call["input"]] == ["user", "assistant", "user"]

    # Conversation APIs: list, detail, rename, feedback.
    listing = (await client.get(f"/v1/orgs/{seed.org_id}/conversations", headers=member)).json()
    assert [c["id"] for c in listing["conversations"]] == [conversation_id]
    detail = (await client.get(f"/v1/conversations/{conversation_id}", headers=member)).json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"] * 2
    assert all(m["usage"] is None for m in detail["messages"])  # admins only
    renamed = await client.patch(
        f"/v1/conversations/{conversation_id}", headers=member, json={"title": "Leave"}
    )
    assert renamed.json()["title"] == "Leave"
    answer_id = detail["messages"][1]["id"]
    feedback = await client.post(
        f"/v1/messages/{answer_id}/feedback", headers=member, json={"value": -1, "comment": "x"}
    )
    assert feedback.json() == {"message_id": answer_id, "feedback": -1, "feedback_comment": "x"}
    bad = await client.post(
        f"/v1/messages/{detail['messages'][0]['id']}/feedback", headers=member, json={"value": 1}
    )
    assert bad.status_code == 422

    # Owner-only: the platform admin and other users get 404 for someone else's chat.
    for other in (seed.admin_id, seed.outsider_id):
        headers = {"X-API-Key": api_key, "X-User-Id": other}
        assert (
            await client.get(f"/v1/conversations/{conversation_id}", headers=headers)
        ).status_code == 404
        assert (
            await client.post(
                f"/v1/messages/{answer_id}/feedback", headers=headers, json={"value": 1}
            )
        ).status_code == 404
    admin = {"X-API-Key": api_key, "X-User-Id": seed.admin_id}
    response = await client.post(
        url, headers=admin, json={"conversation_id": conversation_id, "message": "hi"}
    )
    assert response.status_code == 404

    # Analytics (admin) sees the chats.
    stats = (await client.get(f"/v1/analytics?org_id={seed.org_id}", headers=admin)).json()
    assert stats["totals"]["requests"] == 2 and stats["totals"]["messages"] == 2
    assert stats["totals"]["cost_usd"] > 0 and stats["totals"]["p50_ttft_ms"] is not None
    assert {d["doc_code"] for d in stats["top_documents"]} == {"SIM-HR-102", "SIM-IT-001"}
    assert {a["agent"] for a in stats["by_agent"]} == {"HR", "Scoped"}
    assert stats["feedback"] == {"up": 0, "down": 1}
    assert any(day["cost_usd"] > 0 for day in stats["timeseries"])
    assert sum(row["answers"] for row in stats["by_model_tier"]) == 2
    assert all(row["answer_cost_usd"] <= row["cost_usd"] for row in stats["by_model_tier"])
    assert (await client.get("/v1/analytics", headers=member)).status_code == 403  # members can't

    deleted = await client.delete(f"/v1/conversations/{conversation_id}", headers=member)
    assert deleted.status_code == 204
    assert await _rows("SELECT 1 FROM messages WHERE conversation_id = :c", c=conversation_id) == []


async def test_chat_rejects_bad_input(
    client: AsyncClient, api_key: str, seed: Seed, corpus: dict[str, uuid.UUID]
) -> None:
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    url = f"/v1/orgs/{seed.org_id}/chat"
    assert (await client.post(url, headers=member, json={"message": "  "})).status_code == 422
    assert (await client.post(url, headers=member, json={"message": "x" * 4001})).status_code == 422
    response = await client.post(
        url, headers=member, json={"message": "hi", "document_ids": [str(uuid.uuid4())]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_documents"
    response = await client.post(
        url, headers=member, json={"message": "hi", "conversation_id": str(uuid.uuid4())}
    )
    assert response.status_code == 404
    outsider = {"X-API-Key": api_key, "X-User-Id": seed.outsider_id}
    assert (await client.post(url, headers=outsider, json={"message": "hi"})).status_code == 404


async def test_clarifying_question_skips_retrieval(
    client: AsyncClient,
    api_key: str,
    seed: Seed,
    corpus: dict[str, uuid.UUID],
    fake_openai: FakeOpenAI,
) -> None:
    # Make HR multi-country so the policy allows asking.
    await _index_document(
        seed.org_id,
        "SIM-HR-103",
        "France HR Manual",
        "HR",
        "FR",
        [_draft(0, "5.2 Paid Leave\n\n25 working days.", "5.2", "Paid Leave", 16)],
    )
    fake_openai.route = fake_openai.route | {
        "jurisdiction": None,
        "needs_clarification": True,
        "clarifying_question": "Which country do you work in — Germany or France?",
    }
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    response = await client.post(
        f"/v1/orgs/{seed.org_id}/chat", headers=member, json={"message": "How much leave?"}
    )
    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names == ["meta", "routing", "sources", "delta", "citations", "usage", "done"]
    assert events[2][1] == [] and events[4][1] == []
    assert events[3][1]["text"].startswith("Which country")
    assert not any("embed" in call for call in fake_openai.calls)
    assert not any(call.get("stream") for call in fake_openai.calls)
    await _wait_for_titles()


async def test_disconnect_saves_stopped_message(
    seed: Seed, corpus: dict[str, uuid.UUID], fake_openai: FakeOpenAI
) -> None:
    """Closing the event stream mid-answer (what a client disconnect does) keeps the partial
    answer as `stopped` and still meters the answer call."""
    from app.core.security import Actor
    from app.schemas.chat import ChatRequest

    fake_openai.stream_delay = 0.01
    actor = Actor(id=seed.member_id, email="m@example.test", name="m", is_admin=False)
    async with session_scope() as session:
        turn: ChatTurn = await chat_service.prepare_turn(
            session, seed.org_id, actor, ChatRequest(message="How much leave in Germany?")
        )
    assert turn.settings == default_settings()

    events = chat_service.run_chat(turn)
    received: list[str] = []
    async for event in events:
        received.append(event["event"])
        if received.count("delta") == 2:
            break
    await events.aclose()
    with contextlib.suppress(Exception):
        await _wait_for_titles()

    assert received[:3] == ["meta", "routing", "sources"]
    message = await _rows(
        "SELECT content, status FROM messages WHERE id = :m", m=turn.assistant_message_id
    )
    assert message[0].status == "stopped"
    assert 0 < len(message[0].content) < len(ANSWER)
    answer_rows = await _rows(
        "SELECT status, output_tokens, pricing_estimated FROM llm_usage"
        " WHERE message_id = :m AND operation = 'answer'",
        m=turn.assistant_message_id,
    )
    assert len(answer_rows) == 1
    assert answer_rows[0].status == "stopped"
    assert answer_rows[0].output_tokens > 0 and answer_rows[0].pricing_estimated is True
    # A stopped first turn still gets a title.
    title = await _rows("SELECT title FROM conversations WHERE id = :c", c=turn.conversation_id)
    assert title[0].title == "German annual leave entitlement"


async def test_settings_admin_only_and_validated(
    client: AsyncClient, api_key: str, seed: Seed
) -> None:
    admin = {"X-API-Key": api_key, "X-User-Id": seed.admin_id}
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    url = f"/v1/orgs/{seed.org_id}/settings"

    assert (await client.get(url, headers=member)).status_code == 403
    current = (await client.get(url, headers=admin)).json()
    assert current["overrides"]["chat_service_tier"] is None
    assert current["chat_model"] in current["pricing"]
    assert "text-embedding-3-small" not in current["models"]

    for bad in ({"chat_model": "gpt-unknown"}, {"chat_service_tier": "cheap"}, {"top_k": 16}):
        assert (await client.put(url, headers=admin, json=bad)).status_code == 422

    updated = (
        await client.put(url, headers=admin, json={"chat_service_tier": "flex", "top_k": 5})
    ).json()
    assert updated["chat_service_tier"] == "flex" and updated["top_k"] == 5
    assert updated["updated_by"] == seed.admin_id
    reset = (await client.put(url, headers=admin, json={"chat_service_tier": None})).json()
    assert reset["chat_service_tier"] == reset["defaults"]["chat_service_tier"]
    assert reset["top_k"] == 5  # untouched


async def test_admin_orgs_overview(client: AsyncClient, api_key: str, seed: Seed) -> None:
    admin = {"X-API-Key": api_key, "X-User-Id": seed.admin_id}
    orgs = (await client.get("/v1/admin/orgs", headers=admin)).json()["orgs"]
    mine = next(o for o in orgs if o["id"] == seed.org_id)
    assert mine["members"] == 2 and mine["documents"] == 0 and mine["cost_30d_usd"] == 0
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    assert (await client.get("/v1/admin/orgs", headers=member)).status_code == 403
