"""The judge end to end against the test-schema Postgres: the recorded DocuMind streams (respx,
from test_runs) and a fake Anthropic client (`tests/fake_anthropic.py`) patched into
`app.judge.client.get_client`."""

import uuid
from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import Any

import anthropic
import httpx
import pytest
from sqlalchemy import func, select, text

from app.core.db import session_scope
from app.judge import client as judge_client
from app.judge import registry
from app.models import Claim, JudgeCall, Prompt, RetrievedContext, RunCase
from app.services import run_state
from tests.fake_anthropic import FakeAnthropic, Reply
from tests.test_runs import (  # noqa: F401  (fixtures)
    QUESTION,
    MockDocuMind,
    _clean,
    documind,
    drain,
    get_run,
    make_due,
    published_version,
)

pytestmark = pytest.mark.db

REFUSE = "REFUSE this question please?"


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeAnthropic:
    fake = FakeAnthropic()
    monkeypatch.setattr(judge_client, "get_client", lambda: fake)
    return fake


async def start(api: httpx.AsyncClient, version_id: uuid.UUID, **body: Any) -> dict:
    response = await api.post("/v1/runs", json={"dataset_version_id": str(version_id), **body})
    assert response.status_code == 201, response.text
    return response.json()


async def case_details(api: httpx.AsyncClient, run_id: str) -> list[dict]:
    listing = (await api.get(f"/v1/runs/{run_id}/cases")).json()["cases"]
    return [(await api.get(f"/v1/runs/{run_id}/cases/{c['id']}")).json() for c in listing]


def scores_of(detail: dict) -> dict[str, dict]:
    return {s["metric"]: s for s in detail["scores"]}


async def judge_calls(run_id: str) -> list[JudgeCall]:
    async with session_scope() as session:
        return list(
            (
                await session.scalars(
                    select(JudgeCall)
                    .where(JudgeCall.run_id == uuid.UUID(run_id))
                    .order_by(JudgeCall.created_at)
                )
            ).all()
        )


# --- a full run --------------------------------------------------------------------------------


async def test_full_run_with_judge(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    run = await start(api, await published_version([QUESTION, QUESTION]))
    assert run["snapshot"]["prompts"]["judge.answer_quality"]["version"] >= 1
    await drain()

    detail = await get_run(api, run["id"])
    assert detail["status"] == "completed", detail["error"]
    assert (detail["done_cases"], detail["passed_cases"]) == (2, 2)
    for case in await case_details(api, run["id"]):
        scores = scores_of(case)
        assert scores["faithfulness"]["value"] == 1.0
        assert scores["hallucination"]["value"] == 0.0
        # Two claims, one cited ([1], supported by source 1) → precision 1, recall 0.5.
        assert scores["citation_precision"]["value"] == 1.0
        assert scores["citation_recall"]["value"] == 0.5
        assert scores["supported_citation_recall"]["value"] == 0.5
        assert scores["behavior_correct"]["value"] == 1.0
        assert scores["false_refusal"]["value"] == 0.0
        assert scores["answer_quality"]["value"] == 1.0
        assert scores["answer_quality.completeness"]["value"] == 0.75
        assert scores["answer_quality.relevance"]["value"] == 1.0
        assert scores["answer_quality.jurisdiction_handling"]["status"] == "na"
        # golden-like cases have no reference: reference-based metrics are na (no_reference).
        for key in ("answer_quality.correctness", "key_fact_recall", "context_recall"):
            assert scores[key]["status"] == "na"
            assert scores[key]["details"]["reason"] == "no_reference"
        assert scores["followup_resolution"]["status"] == "na"
        # Sources 1 and 3 relevant out of 8 → AP = (1/1 + 2/3) / 2.
        assert scores["context_precision"]["value"] == pytest.approx((1 + 2 / 3) / 2)
        assert scores["citation_validity"]["value"] == 1.0  # deterministic scores are kept
        assert len(case["claims"]) == 2 and case["claims"][0]["verdict"] == "supported"
        relevant = sorted(c["n"] for c in case["contexts"] if c["judge_relevant"])
        assert relevant == [1, 3]
        assert scores["answer_quality"]["details"]["summary"] == "Accurate and grounded."

    calls = await judge_calls(run["id"])
    # Per case: extract, verify, relevance, behaviour, quality (no key facts, no follow-up).
    assert Counter(c.purpose for c in calls) == Counter(
        {k: 2 for k in ("judge.claims_extract", "judge.claims_verify",
                        "judge.context_relevance", "judge.behavior", "judge.answer_quality")}
    )  # fmt: skip
    assert all(c.status == "ok" and c.prompt_version_id for c in calls)
    total = sum((c.cost_usd for c in calls), Decimal(0))
    assert total > 0
    assert Decimal(str(detail["judge_cost_usd"])) == total
    by_purpose: dict[str, list[JudgeCall]] = {}
    for call in calls:
        by_purpose.setdefault(call.purpose, []).append(call)
    for purpose_calls in by_purpose.values():  # the second case reads the cached system prompt
        assert purpose_calls[0].cache_write_tokens > 0
        assert purpose_calls[1].cache_read_tokens > 0
    async with session_scope() as session:
        case_cost = await session.scalar(
            select(func.sum(RunCase.judge_cost_usd)).where(RunCase.run_id == uuid.UUID(run["id"]))
        )
    assert case_cost == total
    quality = next(a for a in detail["aggregates"] if a["metric"] == "answer_quality")
    assert quality["n"] == 2 and quality["mean"] == 1.0


async def test_judge_disabled_skips_the_judge(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    run = await start(api, await published_version([QUESTION]), judge={"enabled": False})
    await drain()
    detail = await get_run(api, run["id"])
    assert detail["status"] == "completed" and detail["passed_cases"] == 1
    assert fake.calls == []
    (case,) = await case_details(api, run["id"])
    assert "faithfulness" not in scores_of(case)


async def test_unknown_judge_model_is_rejected(api: httpx.AsyncClient) -> None:
    version_id = await published_version([QUESTION])
    response = await api.post(
        "/v1/runs",
        json={"dataset_version_id": str(version_id), "judge": {"models": {"rubric": "gpt-x"}}},
    )
    assert response.status_code == 422


# --- retries reuse paid calls ------------------------------------------------------------------


def _server_error() -> anthropic.InternalServerError:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.InternalServerError(
        "overloaded", response=httpx.Response(500, request=request), body=None
    )


async def test_retry_reuses_calls_by_request_hash(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    failures = iter([_server_error()])
    default = fake.outputs["judge.answer_quality"]
    fake.outputs["judge.answer_quality"] = lambda request: next(failures, default)

    run = await start(api, await published_version([QUESTION]))
    await drain()  # generate, then judge attempt 1 fails on answer_quality (a 5xx)
    async with session_scope() as session:
        job = (
            await session.execute(
                text("SELECT status, attempts FROM jobs WHERE kind = 'case_judge'")
            )
        ).one()
    assert (job.status, job.attempts) == ("queued", 1)
    calls_after_first = Counter(fake.keys())

    await make_due()
    await drain()
    detail = await get_run(api, run["id"])
    assert detail["status"] == "completed" and detail["done_cases"] == 1
    calls = Counter(fake.keys())
    # Attempt 2 reused every call attempt 1 paid for; only answer_quality was called again.
    for key in ("judge.claims_extract", "judge.claims_verify", "judge.behavior",
                "judge.context_relevance"):  # fmt: skip
        assert calls[key] == calls_after_first[key] == 1
    assert calls["judge.answer_quality"] == 2
    assert len(await judge_calls(run["id"])) == 5  # the 5xx wrote no row


# --- refusals ----------------------------------------------------------------------------------


def _refuse_on(question: str, default: Any) -> Any:
    def produce(request: dict) -> Any:
        packet = request["messages"][0]["content"][0]["text"]
        if question in packet:
            return Reply(stop_reason="refusal", text="")
        return default(request) if callable(default) else default

    return produce


async def test_refusal_is_its_own_status_and_out_of_the_mean(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    for key in ("judge.answer_quality", "judge.behavior"):  # rubric and claims roles
        fake.outputs[key] = _refuse_on(REFUSE, fake.outputs[key])
    run = await start(api, await published_version([QUESTION, REFUSE]))
    await drain()

    detail = await get_run(api, run["id"])
    assert detail["status"] == "completed" and detail["done_cases"] == 2
    by_question = {c["question"]: scores_of(c) for c in await case_details(api, run["id"])}
    refused = by_question[REFUSE]
    assert refused["answer_quality"]["status"] == "refusal"
    assert refused["answer_quality.completeness"]["status"] == "refusal"
    assert refused["behavior_correct"]["status"] == "refusal"
    assert refused["faithfulness"]["status"] == "ok"  # other groups still ran
    quality = next(a for a in detail["aggregates"] if a["metric"] == "answer_quality")
    assert quality["n"] == 1 and quality["details"] == {"refusal": 1}
    assert detail["passed_cases"] == 2  # a refusal doesn't fail a gate
    statuses = Counter(c.status for c in await judge_calls(run["id"]))
    assert statuses["refusal"] == 2


# --- budget ------------------------------------------------------------------------------------


async def test_budget_pauses_the_run(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    run = await start(api, await published_version([QUESTION, QUESTION]),
                      max_judge_cost_usd=0.000001)  # fmt: skip
    await drain()
    await run_state.sweep()
    detail = await get_run(api, run["id"])
    assert detail["status"] == "paused" and detail["status_reason"] == "budget"
    assert detail["judge_cost_usd"] >= 0.000001
    assert detail["done_cases"] == 0

    refused = await api.post(f"/v1/runs/{run['id']}/resume")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "budget_exhausted"
    resumed = await api.post(f"/v1/runs/{run['id']}/resume", json={"max_judge_cost_usd": 10})
    assert resumed.status_code == 200 and resumed.json()["status"] == "running"
    await make_due()
    await drain()
    detail = await get_run(api, run["id"])
    assert detail["status"] == "completed" and detail["done_cases"] == 2
    calls = await judge_calls(run["id"])
    assert Decimal(str(detail["judge_cost_usd"])) == sum((c.cost_usd for c in calls), Decimal(0))
    # The calls paid before the pause were reused, not repeated (the two cases ask the same
    # question, so their hashes match across cases).
    assert len({(c.run_case_id, c.request_hash) for c in calls}) == len(calls) == 10


def _usage_limit() -> anthropic.BadRequestError:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.BadRequestError(
        "You have reached your specified API usage limits.",
        response=httpx.Response(400, request=request),
        body=None,
    )


async def test_account_level_refusal_pauses_instead_of_erroring(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    limited = True
    default = fake.outputs["judge.behavior"]
    fake.outputs["judge.behavior"] = lambda request: _usage_limit() if limited else default

    run = await start(api, await published_version([QUESTION, QUESTION]))
    await drain()
    await run_state.sweep()
    detail = await get_run(api, run["id"])
    assert detail["status"] == "paused" and detail["status_reason"] == "judge_unavailable"
    assert (detail["done_cases"], detail["failed_cases"]) == (0, 0)  # nothing became an error

    limited = False  # e.g. the owner raised the spend limit
    resumed = await api.post(f"/v1/runs/{run['id']}/resume")
    assert resumed.status_code == 200 and resumed.json()["status_reason"] is None
    await make_due()
    await drain()
    detail = await get_run(api, run["id"])
    assert detail["status"] == "completed" and detail["done_cases"] == 2
    for case in await case_details(api, run["id"]):
        assert scores_of(case)["behavior_correct"]["status"] == "ok"


# --- rejudge -----------------------------------------------------------------------------------


async def test_rejudge_makes_no_documind_calls(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    source = await start(api, await published_version([QUESTION, QUESTION]))
    await drain()
    chats = documind.chat.call_count
    usage_calls = documind.usage.call_count

    response = await api.post(
        f"/v1/runs/{source['id']}/rejudge", json={"judge": {"samples": 3}, "name": "N=3"}
    )
    assert response.status_code == 201, response.text
    rejudge = response.json()
    assert rejudge["source_run_id"] == source["id"]
    assert rejudge["config"]["judge"]["samples"] == 3
    await drain()

    detail = await get_run(api, rejudge["id"])
    assert detail["status"] == "completed", detail["error"]
    assert detail["done_cases"] == 2 and detail["documind_cost_usd"] == 0
    assert documind.chat.call_count == chats
    assert documind.usage.call_count == usage_calls  # finalize skips DocuMind for a rejudge
    for case in await case_details(api, rejudge["id"]):
        scores = scores_of(case)
        assert case["answer"] and len(case["contexts"]) == 8
        assert scores["citation_validity"]["value"] == 1.0  # copied deterministic score
        assert scores["answer_quality"]["n_samples"] == 3
        assert scores["answer_quality"]["spread"] == 0.0
        assert scores["answer_quality.completeness"]["n_samples"] == 3
    calls = await judge_calls(rejudge["id"])
    assert Counter(c.purpose for c in calls)["judge.answer_quality"] == 6
    assert Decimal(str(detail["judge_cost_usd"])) == sum((c.cost_usd for c in calls), Decimal(0))
    # The source run is untouched.
    source_detail = await get_run(api, source["id"])
    assert source_detail["done_cases"] == 2


async def test_rejudge_needs_a_finished_full_run(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    run = await start(api, await published_version([QUESTION]))
    response = await api.post(f"/v1/runs/{run['id']}/rejudge", json={})
    assert response.status_code == 409 and response.json()["error"]["code"] == "run_not_finished"
    assert (await api.post(f"/v1/runs/{uuid.uuid4()}/rejudge", json={})).status_code == 404


# --- prompt registry ---------------------------------------------------------------------------


def _probe_specs(tmp: Path, edit: str | None = None) -> dict[str, registry.PromptSpec]:
    (tmp / "_rules.md").write_text(
        (registry.PROMPTS_DIR / "_rules.md").read_text(encoding="utf-8"), encoding="utf-8"
    )
    source = (registry.PROMPTS_DIR / "judge.behavior.md").read_text(encoding="utf-8")
    source = source.replace("key: judge.behavior", "key: judge.zz_probe")
    if edit:
        source = source.replace("# Task:", f"# Task ({edit}):", 1)
    (tmp / "judge.zz_probe.md").write_text(source, encoding="utf-8")
    return registry.load_prompts(tmp)


async def test_registry_versions_and_routes(api: httpx.AsyncClient, tmp_path: Path) -> None:
    async with session_scope() as session:
        await registry.sync(session)  # the real files, as at startup
        first = await registry.sync(session, _probe_specs(tmp_path))
    async with session_scope() as session:
        again = await registry.sync(session, _probe_specs(tmp_path))
    assert first == again and first["judge.zz_probe"]["version"] == 1
    async with session_scope() as session:
        edited = await registry.sync(session, _probe_specs(tmp_path, edit="v2"))
    assert edited["judge.zz_probe"]["version"] == 2
    assert edited["judge.zz_probe"]["version_id"] != first["judge.zz_probe"]["version_id"]

    try:
        listing = {p["key"]: p for p in (await api.get("/v1/prompts")).json()}
        assert listing["judge.zz_probe"]["versions"] == 2
        assert listing["judge.zz_probe"]["file_present"] is False
        assert listing["judge.answer_quality"]["current_version"] is not None
        versions = (await api.get("/v1/prompts/judge.zz_probe/versions")).json()
        assert [v["version"] for v in versions] == [2, 1]
        assert versions[0]["params"]["schema"] == "Behavior"
        diff = (await api.get("/v1/prompts/judge.zz_probe/diff?from=1&to=2")).json()["diff"]
        assert "-# Task: classify" in diff and "+# Task (v2): classify" in diff
        missing = await api.get("/v1/prompts/judge.zz_probe/diff?from=1&to=9")
        assert missing.status_code == 404
        assert (await api.get("/v1/prompts/nope/versions")).status_code == 404
    finally:
        async with session_scope() as session:
            await session.execute(text("DELETE FROM prompts WHERE key = 'judge.zz_probe'"))


async def test_a_run_judges_with_its_recorded_prompt_versions(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    run = await start(api, await published_version([QUESTION]))
    await drain()
    recorded = {ref["version_id"] for ref in run["snapshot"]["prompts"].values()}
    used = {str(c.prompt_version_id) for c in await judge_calls(run["id"])}
    assert used <= recorded
    async with session_scope() as session:
        claims = await session.scalar(select(func.count()).select_from(Claim))
        relevant = await session.scalar(
            select(func.count()).where(RetrievedContext.judge_relevant.is_(True))
        )
        prompts = await session.scalar(select(func.count()).select_from(Prompt))
    assert claims == 2 and relevant == 2 and prompts >= 7
