"""Datasets, versions, cases, import/export and auth, through the API (test schema)."""

import json
import uuid

import httpx
import pytest
from sqlalchemy import text

from app.core.db import session_scope

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
async def _clean() -> None:
    async with session_scope() as session:
        await session.execute(text("DELETE FROM jobs"))
        await session.execute(text("DELETE FROM runs"))
        await session.execute(text("DELETE FROM datasets"))


def case(key: str, **fields) -> dict:
    return {
        "case_key": key,
        "type": "single_hop",
        "question": f"Question {key}?",
        "expected_doc_codes": ["SIM-HR-001"],
        "expected_departments": ["HR"],
        **fields,
    }


async def new_dataset(api: httpx.AsyncClient, slug: str = "demo") -> dict:
    response = await api.post("/v1/datasets", json={"slug": slug, "name": "Demo"})
    assert response.status_code == 201, response.text
    return response.json()


async def test_publish_locks_edits(api: httpx.AsyncClient) -> None:
    dataset = await new_dataset(api)
    [draft] = dataset["versions"]
    assert (draft["version"], draft["status"], draft["case_count"]) == (1, "draft", 0)
    vid = draft["id"]

    # An empty draft can't be published.
    assert (await api.post(f"/v1/dataset-versions/{vid}/publish")).json()["error"]["code"] == (
        "empty_version"
    )
    added = [
        (await api.post(f"/v1/dataset-versions/{vid}/cases", json=case(k))).json()
        for k in ("a", "b")
    ]
    assert [c["position"] for c in added] == [0, 1]
    dup = await api.post(f"/v1/dataset-versions/{vid}/cases", json=case("a"))
    assert (dup.status_code, dup.json()["error"]["code"]) == (409, "duplicate_case_key")

    patched = await api.patch(f"/v1/cases/{added[0]['id']}", json={"tags": ["edited"]})
    assert patched.status_code == 200 and patched.json()["tags"] == ["edited"]
    bad_null = await api.patch(f"/v1/cases/{added[0]['id']}", json={"question": None})
    assert bad_null.status_code == 422

    published = await api.post(f"/v1/dataset-versions/{vid}/publish")
    assert published.status_code == 200
    body = published.json()
    assert body["status"] == "published" and body["case_count"] == 2
    assert len(body["content_hash"]) == 64 and body["dataset"]["slug"] == "demo"

    for response in (
        await api.post(f"/v1/dataset-versions/{vid}/cases", json=case("c")),
        await api.patch(f"/v1/cases/{added[0]['id']}", json={"question": "Changed?"}),
        await api.delete(f"/v1/cases/{added[1]['id']}"),
        await api.post(f"/v1/dataset-versions/{vid}/publish"),
    ):
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "version_published"
    cases = (await api.get(f"/v1/dataset-versions/{vid}/cases")).json()
    assert cases["total"] == 2 and cases["cases"][0]["tags"] == ["edited"]


async def test_new_version_copies_the_latest(api: httpx.AsyncClient) -> None:
    dataset = await new_dataset(api)
    v1 = dataset["versions"][0]["id"]
    for key in ("a", "b"):
        await api.post(f"/v1/dataset-versions/{v1}/cases", json=case(key))
    v1_hash = (await api.post(f"/v1/dataset-versions/{v1}/publish")).json()["content_hash"]

    response = await api.post(f"/v1/datasets/{dataset['id']}/versions", json={"notes": "v2"})
    assert response.status_code == 201
    v2 = response.json()
    assert (v2["version"], v2["status"], v2["case_count"], v2["notes"]) == (2, "draft", 2, "v2")
    again = await api.post(f"/v1/datasets/{dataset['id']}/versions")
    assert again.status_code == 409 and again.json()["error"]["details"]["version_id"] == v2["id"]

    v2_cases = (await api.get(f"/v1/dataset-versions/{v2['id']}/cases")).json()["cases"]
    assert [c["case_key"] for c in v2_cases] == ["a", "b"]
    assert {c["id"] for c in v2_cases}.isdisjoint(
        c["id"] for c in (await api.get(f"/v1/dataset-versions/{v1}/cases")).json()["cases"]
    )
    # Edits land in v2 only; an unchanged republish would hash the same.
    assert (await api.delete(f"/v1/cases/{v2_cases[1]['id']}")).status_code == 204
    v2_published = (await api.post(f"/v1/dataset-versions/{v2['id']}/publish")).json()
    assert v2_published["case_count"] == 1 and v2_published["content_hash"] != v1_hash

    detail = (await api.get(f"/v1/datasets/{dataset['id']}")).json()
    assert [v["version"] for v in detail["versions"]] == [2, 1]
    assert detail["latest_published"]["version"] == 2
    listed = (await api.get("/v1/datasets")).json()["datasets"]
    assert [d["slug"] for d in listed] == ["demo"]

    archived = await api.patch(f"/v1/datasets/{dataset['id']}", json={"archived": True})
    assert archived.json()["archived_at"] is not None
    assert (await api.get("/v1/datasets")).json()["datasets"] == []
    assert len((await api.get("/v1/datasets?include_archived=true")).json()["datasets"]) == 1


async def test_export_then_import_round_trips(api: httpx.AsyncClient) -> None:
    dataset = await new_dataset(api)
    vid = dataset["versions"][0]["id"]
    await api.post(f"/v1/dataset-versions/{vid}/cases", json=case("a", tags=["x"]))
    await api.post(
        f"/v1/dataset-versions/{vid}/cases",
        json=case("b", type="multi_hop", key_facts=[{"fact": "30 days", "weight": 2}]),
    )
    source_hash = (await api.post(f"/v1/dataset-versions/{vid}/publish")).json()["content_hash"]

    export = await api.get(f"/v1/dataset-versions/{vid}/export")
    assert export.headers["content-type"].startswith("application/x-ndjson")
    assert 'filename="demo-v1.jsonl"' in export.headers["content-disposition"]
    lines = export.text.splitlines()
    assert [json.loads(line)["case_key"] for line in lines] == ["a", "b"]

    form = {"dataset_slug": "copy", "publish": "true", "kind": "mixed"}
    files = {"file": ("demo.jsonl", export.content, "application/x-ndjson")}
    preview = await api.post("/v1/datasets/import?preview=true", data=form, files=files)
    assert preview.status_code == 200, preview.text
    assert preview.json()["dataset"] is None and len(preview.json()["cases"]) == 2
    assert (await api.get("/v1/datasets")).json()["datasets"][0]["slug"] == "demo"  # not saved

    imported = (await api.post("/v1/datasets/import", data=form, files=files)).json()
    assert imported["dataset"]["slug"] == "copy"
    assert imported["version"]["status"] == "published"
    assert imported["version"]["content_hash"] == source_hash

    again = (await api.post("/v1/datasets/import", data=form, files=files)).json()
    assert again["unchanged"] is True and again["version"]["version"] == 1


async def test_import_mapping_and_row_errors(api: httpx.AsyncClient) -> None:
    rows = [
        {"q": "Leave in Berlin?", "codes": ["SIM-HR-102"], "jurisdiction": "DE"},
        {"q": "AI tools?", "codes": ["SIM-HR-001", "SIM-IT-001"]},
    ]
    content = "\n".join(json.dumps(r) for r in rows).encode()
    form = {
        "dataset_slug": "mapped",
        "mapping": json.dumps(
            {
                "question": "q",
                "expected_doc_codes": "codes",
                "expected_jurisdiction": "jurisdiction",
            }
        ),
        "defaults": json.dumps({"tags": ["imp"], "source": "imported"}),
        "key_prefix": "m",
        "fill_departments": "false",
    }
    response = await api.post(
        "/v1/datasets/import", data=form, files={"file": ("x.jsonl", content)}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [(c["case_key"], c["type"]) for c in body["cases"]] == [
        ("m-001", "jurisdiction"),
        ("m-002", "multi_hop"),
    ]
    assert body["version"]["status"] == "draft" and body["version"]["case_count"] == 2

    bad = await api.post(
        "/v1/datasets/import",
        data={"dataset_slug": "bad"},
        files={"file": ("x.jsonl", b'{"question": "ok"}\n{"question": 5}\n')},
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "invalid_rows"
    assert [e["line"] for e in bad.json()["error"]["details"]] == [2]


async def test_not_found_and_validation(api: httpx.AsyncClient) -> None:
    missing = uuid.uuid4()
    assert (await api.get(f"/v1/datasets/{missing}")).status_code == 404
    assert (await api.get(f"/v1/dataset-versions/{missing}")).status_code == 404
    assert (await api.patch(f"/v1/cases/{missing}", json={"tags": []})).status_code == 404
    assert (await api.post("/v1/datasets", json={"slug": "Bad Slug", "name": "x"})).status_code == (
        422
    )
    await new_dataset(api, "dupe")
    dup = await api.post("/v1/datasets", json={"slug": "dupe", "name": "x"})
    assert (dup.status_code, dup.json()["error"]["code"]) == (409, "duplicate_slug")


async def test_auth(api: httpx.AsyncClient, probe_id: str) -> None:
    assert (await api.get("/v1/datasets", headers={"X-API-Key": "wrong"})).status_code == 401
    assert (await api.get("/v1/datasets", headers={"X-User-Id": ""})).status_code == 401
    unknown = await api.get("/v1/datasets", headers={"X-User-Id": "no-such-user"})
    assert unknown.status_code == 401
    # The probe is a real DocuMind user, but not a platform admin.
    assert (await api.get("/v1/datasets", headers={"X-User-Id": probe_id})).status_code == 403
    assert (await api.get("/v1/datasets")).status_code == 200
