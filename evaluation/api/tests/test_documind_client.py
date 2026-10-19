"""The DocuMind client against respx-mocked DocuMind, and SSE parsing from recorded streams
(`tests/fixtures/sse/*.txt`: answer, clarification and multi_part were recorded from a local
DocuMind as eval-tagged chats; error is hand-written in the same wire format)."""

import contextlib
import json

import httpx
import pytest
import respx

from app.documind.client import DocuMindClient, DocuMindError
from app.documind.events import (
    CitationsEvent,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    MetaEvent,
    RoutingEvent,
    SourcesEvent,
    UnknownEventError,
    UsageEvent,
    parse_event,
)
from tests.conftest import FIXTURES

BASE = "http://documind.test"
ORG = "org-1"
PING = b": ping - 2026-10-19 10:00:00.000000+00:00\r\n\r\n"


def fixture(name: str) -> bytes:
    return (FIXTURES / "sse" / f"{name}.txt").read_bytes()


def with_ping(stream: bytes) -> bytes:
    """Insert a keep-alive comment after the first event, as sse-starlette does every 15 s."""
    head, sep, tail = stream.partition(b"\r\n\r\n")
    return head + sep + PING + tail


@pytest.fixture
def client() -> DocuMindClient:
    return DocuMindClient(BASE, api_key="k", user_id="bot", retry_backoff_s=0)


async def collect(client: DocuMindClient, **kwargs) -> list:
    async with contextlib.aclosing(client.chat(ORG, "question?", **kwargs)) as events:
        return [event async for event in events]


def sse_route(body: bytes) -> respx.Route:
    return respx.post(f"{BASE}/v1/orgs/{ORG}/chat").mock(
        return_value=httpx.Response(
            200, content=body, headers={"content-type": "text/event-stream"}
        )
    )


# --- SSE parsing -----------------------------------------------------------------------------


@respx.mock
async def test_answer_stream(client: DocuMindClient) -> None:
    route = sse_route(with_ping(fixture("answer")))
    events = await collect(
        client, eval_run_id="run-1", eval_case_id="case-1", request_id="eval.run1.golden-001.1"
    )
    sent = route.calls.last.request
    assert sent.headers["X-Eval-Run-Id"] == "run-1"
    assert sent.headers["X-Eval-Case-Id"] == "case-1"
    assert sent.headers["X-Request-ID"] == "eval.run1.golden-001.1"
    assert sent.headers["X-User-Id"] == "bot"
    assert json.loads(sent.content) == {"message": "question?"}

    kinds = [type(e) for e in events]
    assert kinds[:3] == [MetaEvent, RoutingEvent, SourcesEvent]
    assert kinds[-3:] == [CitationsEvent, UsageEvent, DoneEvent]
    assert all(k is DeltaEvent for k in kinds[3:-3])  # the ping produced no event

    routing, sources = events[1].routing, events[2].sources
    assert routing.needs_clarification is False and routing.departments == ["HR"]
    assert sources and all(s.text and s.chunk_id for s in sources)
    assert sources[0].scores.rrf is not None
    answer = "".join(e.text for e in events if isinstance(e, DeltaEvent))
    citations = events[-3].citations
    assert citations and all(f"[{c.n}]" in answer for c in citations)
    usage = events[-2]
    assert usage.by_operation and {u.operation for u in usage.by_operation} >= {"router", "answer"}
    assert usage.retrieval is not None and usage.retrieval.sources
    assert usage.cost_usd > 0 and usage.ttft_ms


@respx.mock
async def test_clarification_stream(client: DocuMindClient) -> None:
    sse_route(fixture("clarification"))
    events = await collect(client)
    routing = next(e for e in events if isinstance(e, RoutingEvent)).routing
    assert routing.needs_clarification is True
    assert routing.clarifying_question
    assert next(e for e in events if isinstance(e, SourcesEvent)).sources == []
    deltas = [e.text for e in events if isinstance(e, DeltaEvent)]
    assert deltas == [routing.clarifying_question]
    usage = next(e for e in events if isinstance(e, UsageEvent))
    assert usage.retrieval is None
    assert [u.operation for u in usage.by_operation] == ["router"]


@respx.mock
async def test_multi_part_stream(client: DocuMindClient) -> None:
    sse_route(fixture("multi_part"))
    events = await collect(client)
    routing = next(e for e in events if isinstance(e, RoutingEvent)).routing
    assert len(routing.parts) == 2
    assert routing.sub_queries == [part.query for part in routing.parts]
    sources = next(e for e in events if isinstance(e, SourcesEvent)).sources
    assert {s.scores.part for s in sources} == {0, 1}  # both parts contributed sources
    assert isinstance(events[-1], DoneEvent)


@respx.mock
async def test_error_stream(client: DocuMindClient) -> None:
    sse_route(fixture("error"))  # LF line endings and a ping comment before the error
    events = await collect(client)
    assert [type(e) for e in events] == [MetaEvent, RoutingEvent, ErrorEvent]
    assert events[-1].message.startswith("Something went wrong")


def test_parse_event_keeps_unknown_fields_and_rejects_unknown_events() -> None:
    event = parse_event("usage", '{"input_tokens": 3, "new_field": 1}')
    assert isinstance(event, UsageEvent) and event.input_tokens == 3
    assert event.model_extra == {"new_field": 1}
    with pytest.raises(UnknownEventError):
        parse_event("surprise", "{}")


# --- retries ---------------------------------------------------------------------------------


@respx.mock
async def test_get_retries_on_502_then_succeeds(client: DocuMindClient) -> None:
    route = respx.get(f"{BASE}/v1/me").mock(
        side_effect=[
            httpx.Response(502),
            httpx.Response(
                200,
                json={
                    "user": {"id": "bot", "email": "b@x", "name": "B", "is_admin": True},
                    "orgs": [{"id": ORG, "name": "Simtora", "slug": "simtora", "role": None}],
                },
            ),
        ]
    )
    me = await client.me()
    assert route.call_count == 2
    assert [o.slug for o in me.orgs] == ["simtora"]


@respx.mock
async def test_get_retries_connection_errors_then_gives_up(client: DocuMindClient) -> None:
    route = respx.get(f"{BASE}/health").mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(DocuMindError) as caught:
        await client.health()
    assert route.call_count == 3  # first attempt + 2 retries
    assert caught.value.status_code is None and caught.value.retryable


@respx.mock
async def test_get_does_not_retry_4xx(client: DocuMindClient) -> None:
    route = respx.get(f"{BASE}/v1/orgs/{ORG}/documents").mock(
        return_value=httpx.Response(
            404, json={"error": {"code": "not_found", "message": "Organization not found."}}
        )
    )
    with pytest.raises(DocuMindError) as caught:
        await client.documents(ORG)
    assert route.call_count == 1
    assert (caught.value.status_code, caught.value.code) == (404, "not_found")
    assert not caught.value.retryable


@respx.mock
async def test_post_chat_never_retries(client: DocuMindClient) -> None:
    route = respx.post(f"{BASE}/v1/orgs/{ORG}/chat").mock(return_value=httpx.Response(502))
    with pytest.raises(DocuMindError) as caught:
        await collect(client)
    assert route.call_count == 1
    assert caught.value.status_code == 502 and caught.value.retryable


@respx.mock
async def test_post_retrieve_never_retries(client: DocuMindClient) -> None:
    route = respx.post(f"{BASE}/v1/orgs/{ORG}/retrieve").mock(return_value=httpx.Response(503))
    with pytest.raises(DocuMindError):
        await client.retrieve(ORG, "q", modes=["bm25", "hybrid"], top_k=5)
    assert route.call_count == 1
    assert json.loads(route.calls.last.request.content) == {
        "query": "q",
        "modes": ["bm25", "hybrid"],
        "top_k": 5,
    }


@respx.mock
async def test_chat_error_status_carries_documind_code(client: DocuMindClient) -> None:
    respx.post(f"{BASE}/v1/orgs/{ORG}/chat").mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "overrides_require_eval", "message": "Needs eval."}}
        )
    )
    with pytest.raises(DocuMindError) as caught:
        await collect(client, overrides={"top_k": 3})
    assert (caught.value.status_code, caught.value.code) == (403, "overrides_require_eval")
