"""Offline judging: `EVAL_JUDGE_MODE=offline` parks every Anthropic call as a task, a stand-in for
Claude Code answers them (here: the fake's canned outputs), and the job completes without a
single API call."""

import httpx
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import session_scope
from app.judge import offline
from app.models import JudgeCall, OfflineTask
from tests.fake_anthropic import FakeAnthropic
from tests.test_judge import fake, judge_calls, scores_of, start  # noqa: F401  (fixtures)
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


def as_request(task: OfflineTask) -> dict:
    return {
        "system": [{"type": "text", "text": task.system}],
        "messages": [
            {"role": "user", "content": [{"text": task.packet}, {"text": task.task}]}
        ],
        "output_config": {"format": {"schema": task.output_schema}},
    }


async def answer_pending(fake: FakeAnthropic) -> int:
    tasks = await offline.pending(500)
    for task in tasks:
        request = as_request(task)
        produced = fake.outputs[fake.key_of(request)]
        output = produced(request) if callable(produced) else produced
        result = await offline.fulfil(task.id, output)
        assert result.ok, result.error
    return len(tasks)


async def test_offline_judging_completes_a_run_without_api_calls(
    api: httpx.AsyncClient,
    documind: MockDocuMind,
    fake: FakeAnthropic,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "eval_judge_mode", "offline")
    run = await start(api, await published_version([QUESTION]))
    assert run["snapshot"]["eval"]["judge_mode"] == "offline"

    rounds = 0
    while True:
        await drain()
        if (await get_run(api, run["id"]))["status"] == "completed":
            break
        assert await answer_pending(fake) > 0, "the run is stuck with nothing to answer"
        await make_due()
        rounds += 1
        assert rounds < 10
    assert rounds >= 2  # claims_verify can only be asked after claims_extract is answered

    assert fake.calls == []  # nothing reached Anthropic
    calls = await judge_calls(run["id"])
    assert calls and all(c.status == "ok" and c.cost_usd == 0 for c in calls)
    assert {c.model_actual for c in calls} == {offline.OFFLINE_MODEL}
    detail = await get_run(api, run["id"])
    assert detail["judge_cost_usd"] == 0 and detail["done_cases"] == 1
    case = (await api.get(f"/v1/runs/{run['id']}/cases")).json()["cases"][0]
    scores = scores_of((await api.get(f"/v1/runs/{run['id']}/cases/{case['id']}")).json())
    assert scores["faithfulness"]["value"] == 1.0
    assert scores["answer_quality"]["value"] == 1.0

    async with session_scope() as session:
        left = await session.scalars(select(OfflineTask).where(OfflineTask.status == "pending"))
        assert list(left) == []


async def test_invalid_offline_output_is_rejected_and_the_task_stays_pending(
    api: httpx.AsyncClient,
    documind: MockDocuMind,
    fake: FakeAnthropic,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "eval_judge_mode", "offline")
    run = await start(api, await published_version([QUESTION]))
    await drain()
    task = (await offline.pending(1))[0]
    bad = await offline.fulfil(task.id, {"nonsense": True})
    assert not bad.ok and "invalid output" in (bad.error or "")
    again = await offline.fulfil(task.id, {"nonsense": True})
    assert not again.ok
    async with session_scope() as session:
        stored = await session.scalar(
            select(JudgeCall).where(JudgeCall.request_hash == task.request_hash)
        )
    assert stored is None
    assert (await get_run(api, run["id"]))["status"] != "failed"
