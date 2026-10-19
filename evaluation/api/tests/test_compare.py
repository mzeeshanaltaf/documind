"""E6 endpoints end to end: `/v1/compare` (paired A/B with the A/A noise floor) and `/v1/trends`
change markers, on retrieval-only runs against the recorded DocuMind."""

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import update

from app.core.db import session_scope
from app.models import Run
from tests.test_runs import (  # noqa: F401 (fixtures)
    ANSWER_SOURCES,
    QUESTION,
    MockDocuMind,
    _clean,
    documind,
    drain,
    published_version,
    start_run,
)
from tests.test_system import dataset_of

pytestmark = pytest.mark.db

SOURCES = [s.model_dump(mode="json") for s in ANSWER_SOURCES]


def retrieval(documind: MockDocuMind, hybrid: list[dict[str, Any]]) -> None:
    documind.retrieve.respond(
        json={
            "routing": {"departments": ["HR"], "jurisdiction": None, "standalone_query": QUESTION},
            "queries": [QUESTION],
            "config": {"top_k": 8, "router_model": "gpt-6-luna"},
            "results": {"hybrid": {"sources": hybrid, "retrieval": {}}},
            "usage": {"input_tokens": 3000, "output_tokens": 90, "cost_usd": 0.0004},
            "timings_ms": {"total": 2100},
        }
    )


async def retrieval_run(
    api: httpx.AsyncClient, version_id: uuid.UUID, **overrides: Any
) -> dict[str, Any]:
    run = await start_run(
        api,
        version_id,
        mode="retrieval_only",
        retrieval_modes=["hybrid"],
        overrides=overrides,
    )
    await drain()
    return run


async def test_compare_and_trends(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    version_id = await published_version([QUESTION] * 6)
    retrieval(documind, SOURCES)
    first = await retrieval_run(api, version_id)
    second = await retrieval_run(api, version_id)  # A/A with `first`
    retrieval(documind, SOURCES[1:])  # the expected section drops out of rank 1
    smaller = await retrieval_run(api, version_id, top_k=4)

    # A vs B: a measured regression, with the top_k change in the config diff.
    response = await api.get(
        "/v1/compare", params={"a": first["id"], "b": smaller["id"], "mode": "hybrid"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["a"]["id"], body["b"]["id"], body["mode"]) == (
        first["id"],
        smaller["id"],
        "hybrid",
    )
    diff = {d["key"]: (d["a"], d["b"]) for d in body["config_diff"]}
    assert diff["config.overrides.top_k"] == (None, 4)
    assert diff["config.effective.top_k"] == (8, 4)
    rows = {m["key"]: m for m in body["metrics"]}
    mrr = rows["mrr"]
    assert mrr["n"] == 6 and mrr["delta"] < 0 and mrr["direction_good"] is False
    assert mrr["ci"] == [pytest.approx(mrr["delta"])] * 2  # six equal drops
    assert mrr["p"] == pytest.approx(2 / 64)  # exact sign-flip: only all-minus/all-plus
    assert mrr["p_holm"] >= mrr["p"]
    assert rows["case_pass"]["test"] == "mcnemar"
    assert body["pairing"]["paired"] == 6 and body["pairing"]["classes"]["unchanged"] == 0
    assert all(c["changes"]["mrr"] == "regressed" for c in body["cases"])
    assert body["cases"][0]["run_case_id_a"] and body["cases"][0]["values"]["mrr"][0] == 1.0
    # The noise floor comes from the other A/A pair, where nothing moved.
    floor = body["noise_floor"]
    assert floor["is_self"] is False
    assert {floor["run_a"], floor["run_b"]} == {first["id"], second["id"]}
    assert floor["metrics"]["mrr"] == 0 and floor["flip_rate"] == 0
    assert mrr["within_noise"] is False
    assert body["warnings"] == []

    # A vs A: nothing significant, everything within its own noise.
    body = (await api.get("/v1/compare", params={"a": first["id"], "b": second["id"]})).json()
    assert body["mode"] == "hybrid" and body["config_diff"] == []
    assert not any(m["significant"] for m in body["metrics"])
    assert body["noise_floor"]["is_self"] is True
    assert all(m["within_noise"] for m in body["metrics"] if m["delta"] is not None)

    # A metric subset, and the refusals.
    body = (
        await api.get(
            "/v1/compare", params=[("a", first["id"]), ("b", smaller["id"]), ("metrics", "mrr")]
        )
    ).json()
    assert [m["key"] for m in body["metrics"]] == ["mrr"]
    assert set(body["cases"][0]["values"]) == {"mrr"}
    bad = await api.get(
        "/v1/compare", params={"a": first["id"], "b": smaller["id"], "metrics": "nope"}
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "unknown_metric"
    bad = await api.get(
        "/v1/compare", params={"a": first["id"], "b": smaller["id"], "mode": "chat"}
    )
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "not_comparable"
    missing = await api.get("/v1/compare", params={"a": first["id"], "b": str(uuid.uuid4())})
    assert missing.status_code == 404

    # Trends: a config marker on the top_k run, none between the A/A runs.
    dataset_id = await dataset_of(version_id)
    trends = (
        await api.get("/v1/trends", params={"dataset_id": str(dataset_id), "metrics": "mrr,hit@5"})
    ).json()
    assert trends["run_mode"] == "retrieval_only"
    assert [r["run_id"] for r in trends["runs"]] == [first["id"], second["id"], smaller["id"]]
    means = [p["mean"] for p in trends["series"]["mrr"]]
    assert means[:2] == [1.0, 1.0] and means[2] < 1.0
    assert [(m["run_id"], m["kinds"]) for m in trends["markers"]] == [(smaller["id"], ["config"])]
    assert {c["key"] for c in trends["markers"][0]["changes"]} >= {"config.overrides.top_k"}
    assert "all" in trends["slices"] and "type:single_hop" in trends["slices"]
    none = (await api.get("/v1/trends", params={"metrics": "mrr", "run_mode": "full"})).json()
    assert none["runs"] == [] and none["series"] == {"mrr": []}

    # Different orgs can't be compared.
    async with session_scope() as session:
        await session.execute(
            update(Run).where(Run.id == uuid.UUID(smaller["id"])).values(org_id="org-other")
        )
    refused = await api.get("/v1/compare", params={"a": first["id"], "b": smaller["id"]})
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "not_comparable"
