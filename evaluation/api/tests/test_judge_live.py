"""Opt-in live smoke (`uv run pytest -m live tests/test_judge_live.py`): two golden cases end to
end against a running DocuMind (`DOCUMIND_API_URL`) and the real Anthropic API. Costs about a
cent. Needs the eval-bot service user and `ANTHROPIC_API_KEY`."""

import json
import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import session_scope
from app.judge import client as judge_client
from app.models import JudgeCall
from app.schemas.datasets import CaseFields, DatasetIn
from app.services import datasets as dataset_service
from tests.test_runs import drain

pytestmark = [pytest.mark.db, pytest.mark.live]


@pytest.fixture(autouse=True)
def _fresh_client() -> None:
    judge_client.get_client.cache_clear()  # other tests may have patched/created one


async def test_two_golden_cases_end_to_end(api: httpx.AsyncClient) -> None:
    if not get_settings().anthropic_api_key:
        pytest.skip("ANTHROPIC_API_KEY is not set")
    lines = get_settings().golden_file.read_text(encoding="utf-8").splitlines()[:2]
    async with session_scope() as session:
        _dataset, version = await dataset_service.create_dataset(
            session,
            DatasetIn(slug=f"live-{uuid.uuid4().hex[:8]}", name="Live smoke", kind="golden"),
            None,
        )
        cases = []
        for i, line in enumerate(lines, start=1):
            row = json.loads(line)
            cases.append(
                CaseFields(
                    case_key=f"g{i:02d}",
                    type="single_hop",
                    question=row["question"],
                    expected_doc_codes=row["expected_doc_codes"],
                    expected_sections=row.get("expected_sections") or [],
                )
            )
        await dataset_service.add_cases(session, version, cases)
        await dataset_service.publish_version(session, version.id, None)

    response = await api.post(
        "/v1/runs",
        json={"dataset_version_id": str(version.id), "org_slug": "simtora", "name": "live smoke"},
    )
    assert response.status_code == 201, response.text
    run_id = response.json()["id"]
    await drain()

    detail = (await api.get(f"/v1/runs/{run_id}")).json()
    assert detail["status"] == "completed", detail["error"]
    assert detail["done_cases"] == 2
    listing = (await api.get(f"/v1/runs/{run_id}/cases")).json()["cases"]
    for case in listing:
        scores = {
            s["metric"]: s
            for s in (await api.get(f"/v1/runs/{run_id}/cases/{case['id']}")).json()["scores"]
        }
        for key in ("faithfulness", "behavior_correct", "citation_recall", "answer_quality"):
            assert scores[key]["status"] == "ok", (key, scores[key])
        assert scores["key_fact_recall"]["details"]["reason"] == "no_reference"
    async with session_scope() as session:
        calls = (
            await session.scalars(select(JudgeCall).where(JudgeCall.run_id == uuid.UUID(run_id)))
        ).all()
    assert calls and all(c.status == "ok" for c in calls)
    total = sum((c.cost_usd for c in calls), Decimal(0))
    assert Decimal(str(detail["judge_cost_usd"])) == total
    print(f"live smoke: {len(calls)} judge calls, ${total}")  # noqa: T201
