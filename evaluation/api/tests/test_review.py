"""E9 end to end on the test schema: a judged run (fake Anthropic, recorded DocuMind) → a blind
stratified review queue → grades → the debounced calibration job → calibration rows and run
badges, which turn `stale` once the rubric prompt changes."""

import copy
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select, text

from app.core.db import session_scope
from app.judge import client as judge_client
from app.judge import registry
from app.models import Job, PromptVersion
from tests.fake_anthropic import DEFAULT_OUTPUTS, FakeAnthropic
from tests.test_judge import start
from tests.test_runs import (  # noqa: F401  (fixtures)
    QUESTION,
    MockDocuMind,
    _clean,
    documind,
    drain,
    make_due,
    published_version,
)

pytestmark = pytest.mark.db

SCORE_RE = re.compile(r"\(score (\d)\)")
JUDGE_SCORES = [5, 4, 3, 2, 1, 5]
METRICS = ["answer_quality.completeness", "faithfulness", "behavior_correct"]


def quality(request: dict[str, Any]) -> dict[str, Any]:
    """The rubric judge's completeness = the `(score N)` the case's question carries."""
    packet = request["messages"][0]["content"][0]["text"]
    output = copy.deepcopy(DEFAULT_OUTPUTS["judge.answer_quality"])
    score = int(SCORE_RE.search(packet).group(1))  # type: ignore[union-attr]
    output["scores"]["completeness"] = score
    output["verdict"] = "pass" if score >= 4 else "fail"
    return output


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeAnthropic:
    fake = FakeAnthropic({"judge.answer_quality": quality})
    monkeypatch.setattr(judge_client, "get_client", lambda: fake)
    return fake


async def judged_run(api: httpx.AsyncClient) -> dict[str, Any]:
    questions = [f"{QUESTION} (score {s})" for s in JUDGE_SCORES]
    run = await start(api, await published_version(questions))
    await drain()
    return run


def score_of(item: dict[str, Any]) -> int:
    return int(SCORE_RE.search(item["packet"]["question"]).group(1))  # type: ignore[union-attr]


def human_grades(item: dict[str, Any], *, off_by_one: bool) -> list[dict[str, Any]]:
    score = score_of(item) - (1 if off_by_one else 0)
    return [
        {"metric": "answer_quality.completeness", "label": str(score), "comment": "ok"},
        {
            "metric": "faithfulness",
            "claim_verdicts": {str(c["idx"]): "supported" for c in item["claims"]},
        },
        {"metric": "behavior_correct", "label": "answered"},
    ]


async def calibration_jobs() -> list[Job]:
    async with session_scope() as session:
        return list(
            (await session.scalars(select(Job).where(Job.kind == "calibration_compute"))).all()
        )


async def test_review_and_calibration(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic, tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:  # fmt: skip
    async with session_scope() as session:
        await session.execute(text("DELETE FROM calibrations"))
        await session.execute(delete(Job).where(Job.kind == "calibration_compute"))
    run = await judged_run(api)

    # Refusals first: not reviewable metrics, a retrieval-only run, nothing eligible.
    bad = await api.post("/v1/review-queues", json={"run_id": run["id"], "metrics": ["mrr"]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "not_reviewable"
    bad = await api.post(
        "/v1/review-queues",
        json={"run_id": run["id"], "metrics": ["answer_quality.correctness"]},  # no reference
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "no_eligible_cases"

    response = await api.post(
        "/v1/review-queues",
        json={"run_id": run["id"], "metrics": METRICS, "size": 5, "seed": 11, "name": "E9 test"},
    )
    assert response.status_code == 201, response.text
    queue = response.json()
    # Stratified on completeness: every score level the judge used is in the sample.
    assert queue["details"]["available"] == {"1": 1, "2": 1, "3": 1, "4": 1, "5": 2}
    assert queue["details"]["picked"] == {"1": 1, "2": 1, "3": 1, "4": 1, "5": 1}
    assert queue["blind"] is True and queue["progress"]["mine_remaining"] == 5

    # Blind: the packet, rubric and claims are there, the judge's grades are not.
    first = (await api.get(f"/v1/review-queues/{queue['id']}/next")).json()["item"]
    assert first["position"] == 1 and first["revealed"] is False and first["judge"] is None
    assert [m["key"] for m in first["metrics"]] == METRICS
    assert first["packet"]["question"].startswith(QUESTION)
    assert first["packet"]["sources"][0]["header"].startswith("[1] ")
    assert len(first["claims"]) == 2 and "verdict" not in first["claims"][0]
    rubric = first["rubrics"]["answer_quality.completeness"]
    assert rubric["groups"][0]["key"] == "completeness"
    assert rubric["prompt_version"] == run["snapshot"]["prompts"]["judge.answer_quality"]["version"]
    assert first["rubrics"]["behavior_correct"]["groups"][0]["anchors"][0]["label"] == "answered"

    body = {"queue_id": queue["id"], "item_id": first["id"]}
    partial = await api.post("/v1/reviews", json={**body, "grades": human_grades(first,
                             off_by_one=False)[:1]})  # fmt: skip
    assert partial.status_code == 422 and partial.json()["error"]["code"] == "bad_grades"

    # Grade every item; one (with a score above 1) a point lower than the judge.
    lowered = False
    for i in range(5):
        item = (await api.get(f"/v1/review-queues/{queue['id']}/next")).json()["item"]
        off = not lowered and score_of(item) > 1
        lowered = lowered or off
        grades = human_grades(item, off_by_one=off)
        response = await api.post(
            "/v1/reviews", json={"queue_id": queue["id"], "item_id": item["id"], "grades": grades}
        )
        assert response.status_code == 200, response.text
        out = response.json()
        assert out["item"]["revealed"] and out["item"]["locked"]
        judge = out["item"]["judge"]
        assert judge["answer_quality.completeness"]["label"] == str(score_of(item))
        assert judge["faithfulness"]["claims"][0]["verdict"] == "supported"
        assert judge["behavior_correct"]["choice"] == "answered"
        assert out["item"]["mine"]["behavior_correct"]["value"] == 1.0
        assert out["progress"]["mine_done"] == i + 1
    again = await api.post("/v1/reviews", json={**body, "grades": human_grades(first,
                           off_by_one=False)})  # fmt: skip
    assert again.status_code == 409 and again.json()["error"]["code"] == "review_locked"
    done = (await api.get(f"/v1/review-queues/{queue['id']}/next")).json()
    assert done["item"] is None and done["progress"]["done"] == 5

    # A second queue over the same run: a skip moves on, and graded cases come back revealed.
    other = (
        await api.post(
            "/v1/review-queues",
            json={"run_id": run["id"], "metrics": METRICS[:1], "sampling": "random", "size": 6},
        )
    ).json()
    listing = (await api.get(f"/v1/review-queues/{other['id']}")).json()
    assert len(listing["items"]) == 6 and listing["progress"]["mine_done"] == 5
    left = (await api.get(f"/v1/review-queues/{other['id']}/next")).json()["item"]
    assert left is not None and left["judge"] is None  # the one case not graded yet
    skipped = await api.post(f"/v1/review-queues/{other['id']}/items/{left['id']}/skip")
    assert skipped.json()["item"] is None and skipped.json()["progress"]["mine_skipped"] == 1
    graded = next(i for i in listing["items"] if i["mine_done"])
    seen = (await api.get(f"/v1/review-queues/{other['id']}/items/{graded['id']}")).json()
    assert seen["revealed"] is True and seen["judge"] is not None

    # One debounced compute job for all the submits.
    assert [j.status for j in await calibration_jobs()] == ["queued"]
    await make_due()
    await drain()
    calibration = (await api.get("/v1/calibration")).json()
    rows = {r["metric"]: r for r in calibration["rows"]}
    completeness = rows["answer_quality.completeness"]
    assert completeness["n"] == 5 and completeness["status"] == "uncalibrated"  # n < 20
    assert completeness["judge_model"] == "claude-haiku-5-5" and completeness["current"]
    assert completeness["exact_pct"] == pytest.approx(0.8)
    assert completeness["bias"] == pytest.approx(0.2)  # the judge one point higher, once
    assert completeness["within1_pct"] == 1.0 and completeness["spearman"] > 0.9
    assert completeness["kappa_weighted"] > 0.8
    assert sum(map(sum, completeness["confusion"]["matrix"])) == 5
    assert len(completeness["details"]["pairs"]) == 5
    assert rows["faithfulness"]["details"]["units"] == 10  # 2 claims × 5 cases
    assert rows["faithfulness"]["kappa"] is None  # everyone said "supported": undefined
    assert rows["behavior_correct"]["exact_pct"] == 1.0

    badges = {b["metric"]: b for b in (await api.get(f"/v1/runs/{run['id']}/calibration")).json()[
        "badges"]}  # fmt: skip
    assert badges["answer_quality.completeness"]["calibration_id"] == completeness["id"]
    assert badges["answer_quality.completeness"]["status"] == "uncalibrated"
    assert badges["context_precision"]["reviewable"] is False
    current = {b["metric"]: b for b in calibration["current"]}
    assert current["answer_quality.completeness"]["n"] == 5

    # Editing judge.answer_quality.md: a new run judges with v+1, so its badge is stale.
    edited = tmp_path / "prompts"
    shutil.copytree(registry.PROMPTS_DIR, edited)
    path = edited / "judge.answer_quality.md"
    path.write_text(path.read_text(encoding="utf-8").replace("# Task:", "# Task (v2):", 1),
                    encoding="utf-8")  # fmt: skip
    specs = registry.load_prompts(edited)
    monkeypatch.setattr(registry, "load_prompts", lambda *_a, **_k: specs)
    fake.by_system[specs["judge.answer_quality"].system] = "judge.answer_quality"
    new_version: uuid.UUID | None = None
    try:
        rerun = await judged_run(api)
        new_version = uuid.UUID(rerun["snapshot"]["prompts"]["judge.answer_quality"]["version_id"])
        assert str(new_version) != run["snapshot"]["prompts"]["judge.answer_quality"]["version_id"]
        stale = {b["metric"]: b for b in (await api.get(
            f"/v1/runs/{rerun['id']}/calibration")).json()["badges"]}  # fmt: skip
        badge = stale["answer_quality.completeness"]
        assert badge["status"] == "stale" and badge["calibration_id"] is None
        assert badge["latest"]["calibration_id"] == completeness["id"]
        # Claims and behaviour prompts didn't change: those badges still match.
        assert stale["faithfulness"]["status"] == "uncalibrated"
        assert stale["faithfulness"]["calibration_id"] == rows["faithfulness"]["id"]
    finally:
        if new_version is not None:
            async with session_scope() as session:
                await session.execute(delete(PromptVersion).where(PromptVersion.id == new_version))
