"""The run engine end to end against the real (test-schema) Postgres and a respx-mocked
DocuMind that replays the recorded SSE fixtures. Worker slots are off in tests, so `drain()`
claims and processes jobs by hand."""

import asyncio
import json
import re
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.db import SessionLocal, session_scope
from app.documind.events import parse_event
from app.models import Job, RunCase
from app.schemas.datasets import CaseFields, DatasetIn
from app.services import datasets as dataset_service
from app.services import run_state
from app.worker import loop, queue
from tests.conftest import FIXTURES

pytestmark = pytest.mark.db

ORG_ID = "org-simtora"
QUESTION = "How long does a performance improvement plan last?"
W = "test-runs"


# --- recorded DocuMind -----------------------------------------------------------------------


def sse_frames(name: str) -> list[tuple[str, str]]:
    """(event, data) pairs of a recorded stream (CRLF or LF)."""
    frames, event, data = [], "message", []
    for line in (FIXTURES / "sse" / f"{name}.txt").read_text(encoding="utf-8").splitlines():
        if not line:
            if data:
                frames.append((event, "\n".join(data)))
            event, data = "message", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data:
        frames.append((event, "\n".join(data)))
    return frames


ANSWER_EVENTS = [parse_event(name, data) for name, data in sse_frames("answer")]
ANSWER_SOURCES = next(e for e in ANSWER_EVENTS if e.event == "sources").sources
ANSWER_TEXT = "".join(e.text for e in ANSWER_EVENTS if e.event == "delta")
ANSWER_USAGE = next(e for e in ANSWER_EVENTS if e.event == "usage")
ANSWER_CITATIONS = next(e for e in ANSWER_EVENTS if e.event == "citations").citations
DOCUMENTS = {s.document_id: s.doc_code for s in ANSWER_SOURCES}


def sse_body(name: str = "answer", conversation_id: str | None = None) -> bytes:
    """The recorded stream, optionally with a fresh conversation id (one per chat)."""
    body = (FIXTURES / "sse" / f"{name}.txt").read_bytes()
    if conversation_id:
        body = re.sub(
            rb'"conversation_id": "[0-9a-f-]{36}"',
            f'"conversation_id": "{conversation_id}"'.encode(),
            body,
            count=1,
        )
    return body


def sse_response(name: str = "answer") -> httpx.Response:
    return httpx.Response(
        200,
        content=sse_body(name, str(uuid.uuid4())),
        headers={"content-type": "text/event-stream"},
    )


class MockDocuMind:
    """Routes for everything the run engine calls. `chat` can be swapped per test."""

    def __init__(self, router: respx.MockRouter) -> None:
        self.router = router
        router.get("/health").respond(json={"status": "ok", "db": "ok", "version": "test-sha"})
        self.me = router.get("/v1/me").respond(
            json={
                "user": {"id": "bot", "email": "bot@x", "name": "Bot", "is_admin": True},
                "orgs": [{"id": ORG_ID, "name": "Simtora", "slug": "simtora", "role": None}],
            }
        )
        self.info = router.get("/v1/admin/eval/info").respond(
            json={"version": "test-sha", "defaults": {}}
        )
        router.get(f"/v1/orgs/{ORG_ID}/settings").respond(
            json={
                "chat_model": "gpt-6-luna",
                "router_model": "gpt-6-luna",
                "chat_service_tier": "standard",
                "background_service_tier": "flex",
                "top_k": 8,
            }
        )
        router.get(f"/v1/orgs/{ORG_ID}/documents").respond(
            json={
                "documents": [
                    {"id": doc_id, "title": code, "doc_code": code}
                    for doc_id, code in DOCUMENTS.items()
                ]
            }
        )
        self.chat = router.post(f"/v1/orgs/{ORG_ID}/chat").mock(
            side_effect=lambda _request: sse_response()
        )
        self.retrieve = router.post(f"/v1/orgs/{ORG_ID}/retrieve")
        self.usage = router.get(path__regex=r"^/v1/admin/eval-runs/[^/]+/usage$").respond(
            json={"totals": {"cost_usd": 0.0036059, "calls": 15}, "by_case": []}
        )
        self.cleanup = router.delete(
            path__regex=r"^/v1/admin/eval-runs/[^/]+/conversations$"
        ).respond(json={"deleted": 5})
        self.run_conversations = router.get(
            path__regex=r"^/v1/admin/eval-runs/[^/]+/conversations$"
        ).respond(json={"conversations": []})
        self.conversation = router.get(path__regex=r"^/v1/conversations/[0-9a-f-]+$")
        self.delete_conversation = router.delete(
            path__regex=r"^/v1/conversations/[0-9a-f-]+$"
        ).respond(status_code=204)


@pytest.fixture
def documind() -> Iterator[MockDocuMind]:
    with respx.mock(base_url=get_settings().documind_api_url, assert_all_called=False) as router:
        yield MockDocuMind(router)


@pytest.fixture(autouse=True)
async def _clean() -> None:
    async with session_scope() as session:
        await session.execute(text("DELETE FROM jobs"))
        await session.execute(text("DELETE FROM runs"))
        await session.execute(text("DELETE FROM datasets"))


# --- helpers ---------------------------------------------------------------------------------


async def published_version(questions: list[str], **fields: Any) -> uuid.UUID:
    async with session_scope() as session:
        dataset, version = await dataset_service.create_dataset(
            session,
            DatasetIn(slug=f"d-{uuid.uuid4().hex[:8]}", name="Run test", kind="golden"),
            None,
        )
        dataset.default_org_slug = "simtora"
        cases = [
            CaseFields(
                case_key=f"c{i:02d}",
                type="single_hop",
                question=question,
                expected_doc_codes=["SIM-HR-001"],
                expected_sections=["SIM-HR-001 §2.4"],
                expected_departments=["HR"],
                **fields,
            )
            for i, question in enumerate(questions, start=1)
        ]
        await dataset_service.add_cases(session, version, cases)
        await dataset_service.publish_version(session, version.id, None)
        return version.id


async def start_run(api: httpx.AsyncClient, version_id: uuid.UUID, **body: Any) -> dict:
    """The run engine without the judge (test_judge.py covers it)."""
    body.setdefault("judge", {"enabled": False})
    response = await api.post("/v1/runs", json={"dataset_version_id": str(version_id), **body})
    assert response.status_code == 201, response.text
    return response.json()


async def drain(limit: int = 200) -> int:
    """Claim and process jobs until none is claimable. Returns how many ran."""
    for count in range(limit):
        job = await queue.claim(W)
        if job is None:
            return count
        await loop.process(job)
    raise AssertionError("drain did not settle")


async def make_due() -> None:
    """Backed-off jobs become claimable now."""
    async with session_scope() as session:
        await session.execute(text("UPDATE jobs SET available_at = now() WHERE status = 'queued'"))


async def get_run(api: httpx.AsyncClient, run_id: str) -> dict:
    response = await api.get(f"/v1/runs/{run_id}")
    assert response.status_code == 200, response.text
    return response.json()


def aggregate(run: dict, metric: str, mode: str = "chat") -> dict:
    return next(a for a in run["aggregates"] if a["metric"] == metric and a["mode"] == mode)


async def finalize_jobs(run_id: str) -> list[Job]:
    async with SessionLocal() as session:
        return list(
            (
                await session.execute(
                    select(Job).where(Job.run_id == uuid.UUID(run_id), Job.kind == "run_finalize")
                )
            ).scalars()
        )


async def until_case_status(run_case_id: uuid.UUID, expected: str) -> None:
    for _ in range(300):
        async with SessionLocal() as session:
            if (await session.get(RunCase, run_case_id)).status == expected:
                return
        await asyncio.sleep(0.1)
    raise AssertionError(f"case {run_case_id} never became {expected}")


# --- tests -----------------------------------------------------------------------------------


async def test_full_run_completes(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    version_id = await published_version([QUESTION] * 5)
    run = await start_run(api, version_id, name="five", tags=["smoke"])
    assert (run["status"], run["total_cases"], run["org_id"]) == ("running", 5, ORG_ID)
    assert run["config"]["effective"] == {
        "chat_model": "gpt-6-luna",
        "router_model": "gpt-6-luna",
        "chat_service_tier": "standard",
        "top_k": 8,
        "retrieval_mode": "hybrid",
    }
    assert run["snapshot"]["documind"]["version"] == "test-sha"
    assert run["snapshot"]["dataset"]["content_hash"]
    assert len(run["config_hash"]) == 64

    assert await drain() == 6  # 5 cases + finalize
    run = await get_run(api, run["id"])
    assert run["status"] == "completed" and not run["partial"]
    assert (run["done_cases"], run["failed_cases"], run["passed_cases"]) == (5, 0, 5)
    assert run["documind_cost_usd"] == pytest.approx(5 * ANSWER_USAGE.cost_usd)
    assert run["documind_cost_reported_usd"] == pytest.approx(0.0036059)
    assert documind.cleanup.call_count == 1
    assert run["case_status_counts"] == {"done": 5}

    hit = aggregate(run, "hit@5")
    assert (hit["n"], hit["mean"], hit["ci_method"]) == (5, 1.0, "wilson")
    assert hit["ci_high"] == 1.0 and hit["ci_low"] < 1.0
    assert aggregate(run, "leakage")["mean"] == 0.0
    assert aggregate(run, "citation_validity")["mean"] == 1.0
    latency = aggregate(run, "latency_ms")
    assert latency["ci_method"] == "bootstrap" and latency["details"]["p50"] == 18281
    assert aggregate(run, "error_rate")["mean"] == 0.0

    # Every chat carried the eval tags and a request id per case.
    run_cases = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"]
    sent = [call.request for call in documind.chat.calls]
    assert {r.headers["X-Eval-Run-Id"] for r in sent} == {run["id"]}
    assert {r.headers["X-Eval-Case-Id"] for r in sent} == {c["id"] for c in run_cases}
    assert {r.headers["X-Request-ID"] for r in sent} == {
        f"eval.{uuid.UUID(run['id']).hex[:8]}.c{i:02d}.1" for i in range(1, 6)
    }

    detail = (await api.get(f"/v1/runs/{run['id']}/cases/{run_cases[0]['id']}")).json()
    assert detail["answer"] == ANSWER_TEXT
    assert detail["ttft_ms"] == ANSWER_USAGE.ttft_ms
    assert detail["correlation_id"] == f"eval:{run['id']}:c01"
    assert {c["mode"] for c in detail["contexts"]} == {"hybrid"}
    assert len(detail["contexts"]) == len(ANSWER_SOURCES) and detail["contexts"][0]["text"]
    assert detail["contexts"][0]["label_relevant"] is True and detail["contexts"][0]["cited"]
    assert detail["metrics"]["chat"]["mrr"] == 1.0
    events = [e["event"] for e in detail["trace"]["turns"][0]["events"]]
    assert events[:3] == ["MetaEvent", "RoutingEvent", "SourcesEvent"]
    assert "text" not in detail["trace"]["turns"][0]["events"][2]["data"]["sources"][0]

    csv_text = (await api.get(f"/v1/runs/{run['id']}/export?format=csv")).text
    header, *rows = csv_text.strip().splitlines()
    assert len(rows) == 5 and "hit@5" in header.split(",")
    exported = (await api.get(f"/v1/runs/{run['id']}/export?format=json")).json()
    assert len(exported["cases"]) == 5 and exported["cases"][0]["contexts"]
    assert exported["run"]["snapshot"]["org"]["id"] == ORG_ID


async def test_progress_stream_replays_and_closes(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    run = await start_run(api, await published_version([QUESTION] * 2))
    await drain()
    response = await api.get(f"/v1/runs/{run['id']}/events")
    assert response.status_code == 200
    frames = [f for f in response.text.replace("\r\n", "\n").split("\n\n") if "event:" in f]
    kinds = [re.search(r"event: (\w+)", f).group(1) for f in frames]
    assert kinds == ["run", "case", "case"]
    assert json.loads(frames[0].split("data: ", 1)[1])["status"] == "completed"
    last_id = re.search(r"id: (\S+)", frames[-1]).group(1)
    resumed = await api.get(f"/v1/runs/{run['id']}/events", headers={"Last-Event-ID": last_id})
    assert resumed.text.count("event: case") == 0 and "event: run" in resumed.text


async def test_permanent_error_case_and_run_completes(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    def chat(request: httpx.Request) -> httpx.Response:
        if json.loads(request.content)["message"].startswith("BAD"):
            return httpx.Response(
                422, json={"error": {"code": "validation_error", "message": "Nope."}}
            )
        return sse_response()

    documind.chat.mock(side_effect=chat)
    run = await start_run(api, await published_version([QUESTION, "BAD question?", QUESTION]))
    await drain()
    run = await get_run(api, run["id"])
    assert run["status"] == "completed"
    assert (run["done_cases"], run["failed_cases"]) == (2, 1)
    assert aggregate(run, "error_rate")["mean"] == pytest.approx(1 / 3)
    errored = (await api.get(f"/v1/runs/{run['id']}/cases?status=error")).json()["cases"]
    assert len(errored) == 1 and errored[0]["error_stage"] == "generate"
    assert "422" in errored[0]["error"]
    assert documind.chat.call_count == 3  # the 4xx wasn't retried


async def test_retryable_error_backs_off_then_errors(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    documind.chat.mock(return_value=httpx.Response(503))
    run = await start_run(api, await published_version([QUESTION]))
    for _ in range(3):  # attempts 1-3 back off
        assert await drain() == 1
        await make_due()
    assert await drain() == 2  # attempt 4 (CASE_ATTEMPTS) errors the case, then the finalize
    run = await get_run(api, run["id"])
    assert documind.chat.call_count == 4
    assert (run["status"], run["failed_cases"]) == ("failed", 1)
    assert run["error"].startswith("Every case failed")


async def test_pause_then_resume(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    gate = asyncio.Event()

    async def slow_chat(_request: httpx.Request) -> httpx.Response:
        await gate.wait()
        return sse_response()

    documind.chat.mock(side_effect=slow_chat)
    run = await start_run(api, await published_version([QUESTION] * 3))
    first = await queue.claim(W)
    in_flight = asyncio.create_task(loop.process(first))
    await until_case_status(first.run_case_id, "generating")

    paused = (await api.post(f"/v1/runs/{run['id']}/pause")).json()
    assert paused["status"] == "pausing"  # a case is still in flight
    assert (await api.post(f"/v1/runs/{run['id']}/pause")).status_code == 409
    gate.set()
    await in_flight
    run = await get_run(api, run["id"])
    assert (run["status"], run["done_cases"]) == ("paused", 1)
    assert await drain() == 0  # a paused run's jobs wait

    assert (await api.post(f"/v1/runs/{run['id']}/resume")).json()["status"] == "running"
    await drain()
    run = await get_run(api, run["id"])
    assert (run["status"], run["done_cases"]) == ("completed", 3)
    assert documind.chat.call_count == 3


async def test_stop_gives_a_partial_run(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    run = await start_run(api, await published_version([QUESTION] * 4))
    await loop.process(await queue.claim(W))  # one case finishes
    stopped = (await api.post(f"/v1/runs/{run['id']}/stop")).json()
    assert stopped["status"] == "finalizing" and stopped["partial"]
    assert (await api.post(f"/v1/runs/{run['id']}/resume")).status_code == 409
    assert await drain() == 1  # only the finalize: the queued cases were cancelled
    run = await get_run(api, run["id"])
    assert (run["status"], run["partial"], run["done_cases"]) == ("stopped", True, 1)
    assert run["case_status_counts"] == {"done": 1, "pending": 3}
    assert aggregate(run, "hit@5")["n"] == 1
    async with SessionLocal() as session:
        cancelled = await session.scalar(
            text("SELECT count(*) FROM jobs WHERE status = 'cancelled' AND run_id = :r"),
            {"r": uuid.UUID(run["id"])},
        )
    assert cancelled == 3


def conversation_payload(conversation_id: str, *, status: str = "complete") -> dict:
    return {
        "id": conversation_id,
        "messages": [
            {"id": str(uuid.uuid4()), "role": "user", "content": QUESTION, "status": "complete"},
            {
                "id": str(uuid.uuid4()),
                "role": "assistant",
                "content": ANSWER_TEXT,
                "status": status,
                "citations": [c.model_dump(mode="json") for c in ANSWER_CITATIONS],
                "sources": [s.model_dump(mode="json") for s in ANSWER_SOURCES],
                "routing": {"departments": ["HR"], "jurisdiction": None},
                "usage": {"latency_ms": 18281, "ttft_ms": 16144, "cost_usd": 0.00072118},
            },
        ],
    }


async def _set_conversation(run_id: str, conversation_id: str) -> None:
    async with session_scope() as session:
        await session.execute(
            text("UPDATE run_cases SET conversation_id = :c WHERE run_id = :r"),
            {"c": uuid.UUID(conversation_id), "r": uuid.UUID(run_id)},
        )


async def test_retry_recovers_a_complete_conversation(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    conversation_id = str(uuid.uuid4())
    documind.conversation.respond(json=conversation_payload(conversation_id))
    run = await start_run(api, await published_version([QUESTION]))
    await _set_conversation(run["id"], conversation_id)  # a previous attempt got this far
    await drain()
    assert documind.chat.call_count == 0 and documind.delete_conversation.call_count == 0
    [case] = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"]
    detail = (await api.get(f"/v1/runs/{run['id']}/cases/{case['id']}")).json()
    assert detail["status"] == "done" and detail["answer"] == ANSWER_TEXT
    assert detail["trace"]["recovered"] is True
    assert detail["metrics"]["chat"]["hit@5"] == 1.0


async def test_retry_restarts_an_incomplete_conversation(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    stale = str(uuid.uuid4())
    documind.conversation.respond(json=conversation_payload(stale, status="stopped"))
    run = await start_run(api, await published_version([QUESTION]))
    await _set_conversation(run["id"], stale)
    await drain()
    assert documind.delete_conversation.call_count == 1
    assert stale in str(documind.delete_conversation.calls.last.request.url)
    assert documind.chat.call_count == 1
    [case] = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"]
    detail = (await api.get(f"/v1/runs/{run['id']}/cases/{case['id']}")).json()
    assert detail["status"] == "done" and detail["conversation_id"] not in (None, stale)


async def test_retry_deletes_a_conversation_it_never_stored(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    """A crash after DocuMind created the conversation but before `meta` was stored: the retry
    finds it through DocuMind's per-case list and deletes it before starting over."""
    orphan = str(uuid.uuid4())
    documind.conversation.respond(json=conversation_payload(orphan, status="stopped"))
    run = await start_run(api, await published_version([QUESTION]))
    async with session_scope() as session:  # attempt 1 died without an outcome
        await session.execute(
            text("UPDATE jobs SET attempts = 1 WHERE run_id = :r"), {"r": uuid.UUID(run["id"])}
        )
    [case] = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"]
    documind.run_conversations.respond(
        json={"conversations": [{"id": orphan, "eval_case_id": case["id"]}]}
    )
    await drain()
    listed = documind.run_conversations.calls.last.request.url
    assert listed.params["case_id"] == case["id"] and run["id"] in listed.path
    assert documind.delete_conversation.call_count == 1
    assert orphan in str(documind.delete_conversation.calls.last.request.url)
    assert documind.chat.call_count == 1
    detail = (await api.get(f"/v1/runs/{run['id']}/cases/{case['id']}")).json()
    assert (detail["status"], detail["attempt"]) == ("done", 2)


async def test_finalize_is_enqueued_once_under_concurrent_completions(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    run = await start_run(api, await published_version([QUESTION] * 3))
    jobs = [await queue.claim(f"{W}-{i}") for i in range(3)]
    assert all(jobs)
    await asyncio.gather(*(loop.process(job) for job in jobs))
    finals = await finalize_jobs(run["id"])
    assert len(finals) == 1 and finals[0].status == "queued"
    async with session_scope() as session:
        assert await queue.enqueue_finalize(session, uuid.UUID(run["id"])) is False
    await drain()
    run = await get_run(api, run["id"])
    assert (run["status"], run["done_cases"]) == ("completed", 3)


async def test_retrieval_only_run(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    sources = [s.model_dump(mode="json") for s in ANSWER_SOURCES]
    documind.retrieve.respond(
        json={
            "routing": {"departments": ["HR"], "jurisdiction": None, "standalone_query": QUESTION},
            "queries": [QUESTION],
            "config": {"top_k": 8, "router_model": "gpt-6-luna"},
            "results": {
                "bm25": {"sources": sources[1:], "retrieval": {}},  # the hit drops to rank 4
                "vector": {"sources": sources, "retrieval": {}},
                "hybrid": {"sources": sources, "retrieval": {}},
            },
            "usage": {"input_tokens": 3000, "output_tokens": 90, "cost_usd": 0.0004},
            "timings_ms": {"total": 2100},
        }
    )
    run = await start_run(
        api,
        await published_version([QUESTION] * 2),
        mode="retrieval_only",
        cleanup_conversations=True,
    )
    assert run["config"]["retrieval_modes"] == ["bm25", "vector", "hybrid"]
    await drain()
    run = await get_run(api, run["id"])
    assert run["status"] == "completed"
    assert aggregate(run, "hit@5", "hybrid")["mean"] == 1.0
    assert aggregate(run, "mrr", "hybrid")["mean"] == 1.0
    sent = json.loads(documind.retrieve.calls.last.request.content)
    assert sent["modes"] == ["bm25", "vector", "hybrid"]
    assert documind.cleanup.call_count == 0  # nothing to clean: no conversations
    assert {a["mode"] for a in run["aggregates"]} == {"bm25", "vector", "hybrid"}
    assert not [a for a in run["aggregates"] if a["metric"] == "citation_validity"]


async def test_run_validation(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    version_id = await published_version([QUESTION])
    bad_metric = await api.post(
        "/v1/runs",
        json={"dataset_version_id": str(version_id), "metrics": {"enabled": ["nope"]}},
    )
    assert bad_metric.status_code == 422
    unknown_org = await api.post(
        "/v1/runs", json={"dataset_version_id": str(version_id), "org_slug": "missing"}
    )
    assert unknown_org.status_code == 404
    mixed = await api.post(
        "/v1/runs",
        json={"dataset_version_id": str(version_id), "retrieval_modes": ["bm25"]},
    )
    assert mixed.status_code == 422
    async with session_scope() as session:
        dataset, draft = await dataset_service.create_dataset(
            session, DatasetIn(slug="draft-only", name="Draft"), None
        )
    draft_run = await api.post("/v1/runs", json={"dataset_version_id": str(draft.id)})
    assert draft_run.status_code == 409


async def test_unknown_scope_code_skips_the_case(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    version_id = await published_version([QUESTION], scope_doc_codes=["SIM-NOPE-999"])
    run = await start_run(api, version_id)
    assert (run["status"], run["skipped_cases"]) == ("finalizing", 1)
    await drain()
    run = await get_run(api, run["id"])
    assert run["status"] == "completed" and run["case_status_counts"] == {"skipped": 1}
    [case] = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"]
    assert "SIM-NOPE-999" in case["error"]


async def test_delete_run_cleans_documind(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    run = await start_run(api, await published_version([QUESTION]))
    assert (await api.delete(f"/v1/runs/{run['id']}")).status_code == 409  # still running
    await drain()
    assert (await api.delete(f"/v1/runs/{run['id']}")).status_code == 204
    assert documind.cleanup.call_count == 2  # finalize + delete
    assert (await api.get(f"/v1/runs/{run['id']}")).status_code == 404


async def test_sweep_errors_a_case_whose_job_failed(
    api: httpx.AsyncClient, documind: MockDocuMind
) -> None:
    run = await start_run(api, await published_version([QUESTION]))
    async with session_scope() as session:
        await session.execute(
            text(
                "UPDATE jobs SET status = 'failed', last_error = 'lock expired' WHERE run_id = :r"
            ),
            {"r": uuid.UUID(run["id"])},
        )
    await run_state.sweep()
    run = await get_run(api, run["id"])
    assert (run["status"], run["failed_cases"]) == ("finalizing", 1)
