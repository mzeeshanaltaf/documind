"""E7 end to end against the test-schema Postgres: DocuMind mocked with respx (documents, chunks,
retrieve) and the fake Anthropic client: generation and validation, auto-reject, the batch cost
cap, review, commit into a draft (published versions untouched) and enrichment."""

import re
import uuid
from collections import Counter
from collections.abc import AsyncIterator, Iterator
from decimal import Decimal
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.db import session_scope
from app.judge import client as judge_client
from app.models import JudgeCall
from app.schemas.datasets import CaseFields, DatasetIn
from app.services import datasets as dataset_service
from tests.fake_anthropic import FakeAnthropic, Reply
from tests.test_runs import drain

pytestmark = pytest.mark.db

ORG = "org-syn"
BODY = " ".join(["The policy sets out the rule for employees and managers."] * 12)
DOCS = {
    "SIM-HR-001": {"title": "Human Resources Policy Manual", "department": "HR",
                   "jurisdiction": "US", "doc_type": "policy_manual"},
    "SIM-HR-102": {"title": "Germany HR Manual", "department": "HR", "jurisdiction": "DE",
                   "doc_type": "country_supplement"},
    "SIM-HR-103": {"title": "France HR Manual", "department": "HR", "jurisdiction": "FR",
                   "doc_type": "country_supplement"},
    "SIM-IT-001": {"title": "IT Policy Manual", "department": "IT", "jurisdiction": "GLOBAL",
                   "doc_type": "policy_manual"},
}  # fmt: skip
SECTIONS = {
    "SIM-HR-001": [("2.4", "Performance Improvement Plans"), ("6.3", "Sick and Safe Leave"),
                   ("6.5", "Parental Leave"), ("3.1", "Open Door and Grievance Procedure")],
    "SIM-HR-102": [("5.2", "Annual Leave"), ("5.3", "Sick Leave"),
                   ("5.4", "Maternity, Parental and Adoption Leave")],
    "SIM-HR-103": [("5.2", "Annual Leave"), ("5.3", "Sick Leave"),
                   ("5.4", "Maternity, Partner and Parental Leave")],
    "SIM-IT-001": [("2.1", "Laptops"), ("2.2", "Passwords"), ("2.3", "Remote Access")],
}  # fmt: skip


def doc_id(code: str) -> str:
    return f"doc-{code.lower()}"


def chunk_rows(code: str) -> list[dict[str, Any]]:
    rows = []
    for i, (number, title) in enumerate(SECTIONS[code]):
        extra = " See SIM-IT-001 for equipment." if (code, number) == ("SIM-HR-001", "3.1") else ""
        rows.append(
            {
                "id": f"{code}-c{i}", "chunk_index": i, "text": f"{title}. {BODY}{extra}",
                "section_path": [title], "section_number": number, "section_title": title,
                "page_start": 10 + i, "page_end": 10 + i, "content_type": "prose",
                "token_count": 150,
            }
        )  # fmt: skip
    return rows


def source(n: int, code: str, number: str) -> dict[str, Any]:
    return {
        "n": n, "chunk_id": f"{code}-x{n}", "document_id": doc_id(code), "doc_code": code,
        "title": DOCS[code]["title"], "section_number": number, "section_title": "Topic",
        "page_start": 3, "page_end": 3, "text": "Unrelated passage.", "department": "HR",
    }  # fmt: skip


class MockDocuMind:
    def __init__(self, router: respx.MockRouter) -> None:
        self.router = router
        router.get("/v1/me").respond(
            json={
                "user": {"id": "bot", "email": "bot@x", "name": "Bot", "is_admin": True},
                "orgs": [{"id": ORG, "name": "Simtora", "slug": "simtora", "role": None}],
            }
        )
        router.get(f"/v1/orgs/{ORG}/documents").respond(
            json={
                "documents": [
                    {"id": doc_id(code), "doc_code": code, "status": "ready", **meta}
                    for code, meta in DOCS.items()
                ]
            }
        )
        self.chunks = router.get(path__regex=rf"^/v1/orgs/{ORG}/documents/[^/]+/chunks$")
        self.chunks.side_effect = self._chunks
        self.retrieve = router.post(f"/v1/orgs/{ORG}/retrieve")
        self.retrieve.side_effect = self._retrieve
        self.retrieve_bodies: list[dict[str, Any]] = []

    def _chunks(self, request: httpx.Request) -> httpx.Response:
        doc = request.url.path.split("/")[-2]
        code = next(c for c in DOCS if doc_id(c) == doc)
        rows = chunk_rows(code)
        offset = int(request.url.params.get("offset", 0))
        return httpx.Response(
            200,
            json={
                "document": {"id": doc, "doc_code": code, **DOCS[code]},
                "total": len(rows), "offset": offset, "limit": 500, "chunks": rows[offset:],
            },
        )  # fmt: skip

    def _retrieve(self, request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content)
        self.retrieve_bodies.append(body)
        assert request.headers["X-Eval-Run-Id"].startswith("syn_")
        if body.get("document_ids"):
            code = next(c for c in DOCS if doc_id(c) in body["document_ids"])
            sources = [source(1, code, SECTIONS[code][0][0])]
            sources[0]["text"] = "The improvement plan lasts 90 days."
        else:
            sources = [source(1, "SIM-IT-001", "2.2"), source(2, "SIM-HR-001", "6.5")]
        return httpx.Response(
            200,
            json={
                "routing": {"departments": [], "standalone_query": body["query"]},
                "results": {"hybrid": {"sources": sources}},
            },
        )


@pytest.fixture
def documind() -> Iterator[MockDocuMind]:
    with respx.mock(base_url=get_settings().documind_api_url, assert_all_called=False) as router:
        yield MockDocuMind(router)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeAnthropic:
    fake = FakeAnthropic()
    monkeypatch.setattr(judge_client, "get_client", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
async def _clean() -> AsyncIterator[None]:
    """Before and after each test. A batch's judge calls outlive it (SET NULL keeps the month's
    spend), so they're deleted here too, or later tests would see this month's synthetic spend."""

    async def wipe() -> None:
        async with session_scope() as session:
            await session.execute(text("DELETE FROM jobs"))
            await session.execute(
                text(
                    "DELETE FROM judge_calls WHERE batch_id IS NOT NULL OR candidate_id IS NOT NULL"
                )
            )
            await session.execute(text("DELETE FROM synthetic_batches"))
            await session.execute(text("DELETE FROM runs"))
            await session.execute(text("DELETE FROM datasets"))

    await wipe()
    yield
    await wipe()


async def published(cases: list[CaseFields] | None = None) -> tuple[uuid.UUID, uuid.UUID]:
    """(dataset id, published v1 id)."""
    async with session_scope() as session:
        dataset, version = await dataset_service.create_dataset(
            session, DatasetIn(slug=f"syn-{uuid.uuid4().hex[:8]}", name="Target", kind="mixed"),
            None,
        )  # fmt: skip
        dataset.default_org_slug = "simtora"
        await dataset_service.add_cases(
            session,
            version,
            cases or [CaseFields(case_key="g1", type="single_hop", question="Existing question?")],
        )
        await dataset_service.publish_version(session, version.id, None)
        return dataset.id, version.id


COUNTS = {"single_hop": 2, "multi_hop": 1, "jurisdiction": 1, "comparative": 1,
          "unanswerable": 1, "out_of_scope": 1}  # fmt: skip


async def create(api: httpx.AsyncClient, **body: Any) -> dict:
    response = await api.post("/v1/synthetic-batches", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def batch_of(api: httpx.AsyncClient, batch_id: str) -> dict:
    response = await api.get(f"/v1/synthetic-batches/{batch_id}")
    assert response.status_code == 200, response.text
    return response.json()


async def candidates_of(api: httpx.AsyncClient, batch_id: str, **params: str) -> list[dict]:
    response = await api.get(f"/v1/synthetic-batches/{batch_id}/candidates", params=params)
    assert response.status_code == 200, response.text
    return response.json()["candidates"]


async def batch_calls(batch_id: str) -> list[JudgeCall]:
    async with session_scope() as session:
        rows = await session.scalars(
            select(JudgeCall).where(JudgeCall.batch_id == uuid.UUID(batch_id))
        )
        return list(rows.all())


# --- generation --------------------------------------------------------------------------------


async def test_batch_generates_and_validates(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    dataset_id, _ = await published()
    batch = await create(
        api, target_dataset_id=str(dataset_id), type_counts=COUNTS, seed=3, name="E7 test"
    )
    assert (batch["status"], batch["candidate_count"]) == ("generating", 7)
    assert batch["config"]["seed"] == 3 and "catalog" not in batch["config"]
    assert batch["estimate_usd"] == pytest.approx(0.49)
    assert batch["max_cost_usd"] == pytest.approx(0.98)  # 2 × the estimate
    assert set(batch["prompt_version_ids"]) >= {"gen.single_hop", "gen.validate"}
    assert batch["counts"]["queued"] == 7

    await drain()
    batch = await batch_of(api, batch["id"])
    assert (batch["status"], batch["generated_count"], batch["failed_count"]) == ("review", 7, 0)
    assert batch["counts"]["pending"] == 7 and batch["finished_at"]
    calls = await batch_calls(batch["id"])
    # One generation and one validation per candidate, all metered to the batch.
    assert len(calls) == 14 and {c.purpose for c in calls} == {"synthetic"}
    assert all(c.candidate_id for c in calls)
    assert batch["cost_usd"] == pytest.approx(float(sum((c.cost_usd for c in calls), Decimal(0))))
    assert batch["cost_usd"] > 0
    assert Counter(fake.keys())["gen.validate"] == 7

    by_type = {c["type"]: c for c in await candidates_of(api, batch["id"])}
    assert set(by_type) == set(COUNTS)
    jurisdiction = by_type["jurisdiction"]
    assert jurisdiction["expected_jurisdiction"] in ("DE", "FR")
    assert jurisdiction["checks"]["sections"]["ok"] and jurisdiction["expected_pages"]
    assert jurisdiction["expected_departments"] == ["HR"]
    for kind in ("unanswerable", "out_of_scope"):
        refusal = by_type[kind]
        assert refusal["expected_behavior"] == "refuse"
        assert refusal["expected_sections"] == [] and refusal["source_chunk_ids"] == []
    # The unanswerable question went through DocuMind's retrieval; its contexts are the excerpt.
    assert documind.retrieve.call_count == 1
    unanswerable = by_type["unanswerable"]
    assert [e["role"] for e in unanswerable["source_excerpt"]] == ["retrieved", "retrieved"]
    assert unanswerable["checks"]["retrieval"][0]["section"] == "SIM-IT-001 §2.2"
    # The catalog prompt saw every document's sections.
    catalog_request = next(r for k, r in fake.calls if k == "gen.out_of_scope")
    assert "§5.4 Maternity, Partner and Parental Leave" in catalog_request["messages"][0][
        "content"][0]["text"]  # fmt: skip


async def test_failing_checks_auto_reject(
    api: httpx.AsyncClient, documind: MockDocuMind, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeAnthropic(
        {
            "gen.validate": {
                "reasoning": "Two readings.", "answerable_from_sources": True,
                "reference_supported": True, "self_contained": True, "ambiguity": "high",
                "issues": ["ambiguous"], "keep": False,
            },
        }
    )  # fmt: skip
    monkeypatch.setattr(judge_client, "get_client", lambda: fake)
    batch = await create(api, org_slug="simtora", type_counts={"single_hop": 2}, seed=1)
    await drain()
    rows = await candidates_of(api, batch["id"])
    assert all(c["status"] == "rejected" and c["auto_rejected"] for c in rows)
    assert {c["reject_reason"] for c in rows} == {"validator_rejected"}
    assert rows[0]["checks"]["failures"] == ["validator_rejected"]
    summary = await batch_of(api, batch["id"])
    assert summary["counts"]["rejected"] == summary["counts"]["auto_rejected"] == 2

    # A human can restore one and approve the other straight away.
    restored = (await api.post(f"/v1/candidates/{rows[0]['id']}/restore")).json()
    assert (restored["status"], restored["auto_rejected"]) == ("pending", True)
    approved = (await api.post(f"/v1/candidates/{rows[1]['id']}/approve")).json()
    assert (approved["status"], approved["reject_reason"], approved["reviewer_id"]) == (
        "approved", None, get_settings().eval_service_user_id,
    )  # fmt: skip


async def test_duplicates_and_bad_sections_auto_reject(
    api: httpx.AsyncClient, documind: MockDocuMind, monkeypatch: pytest.MonkeyPatch
) -> None:
    question = "How long does a performance improvement plan last for employees?"
    fake = FakeAnthropic(
        {
            "gen.single_hop": lambda request: {
                "rationale": "r", "question": question, "reference_answer": "90 days.",
                "key_facts": [{"fact": "90 days.", "weight": 3}], "evidence_quotes": [],
                "expected_doc_codes": ["SIM-HR-001"], "expected_sections": ["SIM-HR-001 §9.9"],
                "expected_jurisdiction": None, "expected_behavior": "answer",
            },
        }
    )  # fmt: skip
    monkeypatch.setattr(judge_client, "get_client", lambda: fake)
    dataset_id, _ = await published(
        [CaseFields(case_key="g1", type="single_hop",
                    question="How long does a performance improvement plan last?")]
    )  # fmt: skip
    batch = await create(
        api, target_dataset_id=str(dataset_id), type_counts={"single_hop": 1}, seed=1
    )
    await drain()
    (row,) = await candidates_of(api, batch["id"])
    assert row["status"] == "rejected"
    assert row["checks"]["duplicate"]["label"] == "g1"
    assert row["checks"]["duplicate"]["score"] >= 0.7
    assert set(row["checks"]["failures"]) >= {"duplicate", "unknown_section"}
    assert row["checks"]["sections"]["unknown_sections"] == ["SIM-HR-001 §9.9"]


async def test_cost_cap_pauses_the_batch(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    batch = await create(
        api, org_slug="simtora", type_counts={"single_hop": 3}, seed=2, max_cost_usd="0.000001"
    )
    await drain()
    paused = await batch_of(api, batch["id"])
    assert (paused["status"], paused["status_reason"]) == ("paused", "budget")
    assert paused["generated_count"] < 3
    assert len(fake.calls) == 1  # the first call crossed the cap; nothing more was spent
    assert (await api.post(f"/v1/synthetic-batches/{batch['id']}/resume")).status_code == 409
    resumed = await api.post(
        f"/v1/synthetic-batches/{batch['id']}/resume", json={"max_cost_usd": "5"}
    )
    assert resumed.status_code == 200 and resumed.json()["status"] == "generating"
    await drain()
    done = await batch_of(api, batch["id"])
    assert (done["status"], done["generated_count"]) == ("review", 3)
    # The interrupted candidate reused its paid generation call (request_hash).
    assert Counter(fake.keys()) == Counter({"gen.single_hop": 3, "gen.validate": 3})


async def test_generation_refusal_fails_the_candidate(
    api: httpx.AsyncClient, documind: MockDocuMind, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeAnthropic({"gen.single_hop": Reply(stop_reason="refusal")})
    monkeypatch.setattr(judge_client, "get_client", lambda: fake)
    batch = await create(api, org_slug="simtora", type_counts={"single_hop": 1}, seed=1)
    await drain()
    (row,) = await candidates_of(api, batch["id"])
    assert (row["gen_status"], row["status"], row["reject_reason"]) == (
        "failed", "rejected", "generation_error",
    )  # fmt: skip
    summary = await batch_of(api, batch["id"])
    assert (summary["status"], summary["failed_count"]) == ("review", 1)
    assert (await api.post(f"/v1/candidates/{row['id']}/approve")).status_code == 409


# --- review & commit ---------------------------------------------------------------------------


async def test_review_and_commit_into_a_new_draft(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    dataset_id, v1_id = await published()
    batch = await create(
        api, target_dataset_id=str(dataset_id), type_counts={"single_hop": 2, "out_of_scope": 1},
        seed=4,
    )  # fmt: skip
    await drain()
    rows = await candidates_of(api, batch["id"])
    first, second = (r for r in rows if r["type"] == "single_hop")
    (third,) = (r for r in rows if r["type"] == "out_of_scope")
    assert [r["type"] for r in rows] == ["single_hop", "out_of_scope", "single_hop"]

    patched = await api.patch(
        f"/v1/candidates/{first['id']}",
        json={"question": "  Edited question about plans?  ", "key_facts": [{"fact": "A."}]},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["edited"] and patched.json()["question"] == "Edited question about plans?"
    assert patched.json()["key_facts"] == [{"fact": "A.", "weight": 1.0}]
    nulled = await api.patch(f"/v1/candidates/{first['id']}", json={"question": None})
    assert nulled.status_code == 422
    for row in (first, third):
        assert (await api.post(f"/v1/candidates/{row['id']}/approve")).status_code == 200
    rejected = await api.post(f"/v1/candidates/{second['id']}/reject", json={"reason": "vague"})
    assert rejected.json()["reject_reason"] == "vague" and not rejected.json()["auto_rejected"]
    pending = await candidates_of(api, batch["id"], status="approved")
    assert len(pending) == 2

    commit = await api.post(f"/v1/synthetic-batches/{batch['id']}/commit", json={})
    assert commit.status_code == 200, commit.text
    out = commit.json()
    assert (out["added"], out["updated"], out["skipped"]) == (2, 0, [])
    assert out["version"]["version"] == 2 and out["version"]["status"] == "draft"
    cases = (await api.get(f"/v1/dataset-versions/{out['version']['id']}/cases")).json()["cases"]
    keys = [c["case_key"] for c in cases]
    prefix = f"syn-{batch['id'].replace('-', '')[:8]}"
    assert keys == ["g1", f"{prefix}-{first['ordinal']:03d}", f"{prefix}-{third['ordinal']:03d}"]
    new = {c["case_key"]: c for c in cases}
    edited = new[f"{prefix}-{first['ordinal']:03d}"]
    assert edited["question"] == "Edited question about plans?" and edited["source"] == "synthetic"
    assert new[f"{prefix}-{third['ordinal']:03d}"]["expected_behavior"] == "refuse"

    # The published v1 is untouched.
    v1 = (await api.get(f"/v1/dataset-versions/{v1_id}")).json()
    assert (v1["status"], v1["case_count"]) == ("published", 1)
    v1_cases = (await api.get(f"/v1/dataset-versions/{v1_id}/cases")).json()["cases"]
    assert [c["case_key"] for c in v1_cases] == ["g1"]

    summary = await batch_of(api, batch["id"])
    assert summary["counts"]["committed"] == 2
    assert summary["committed_version_id"] == out["version"]["id"]
    again = await api.post(f"/v1/synthetic-batches/{batch['id']}/commit", json={})
    assert again.status_code == 422 and again.json()["error"]["code"] == "nothing_to_commit"
    frozen = await api.post(f"/v1/candidates/{first['id']}/reject")
    assert frozen.status_code == 409


async def test_enrichment_updates_cases_in_a_new_draft(
    api: httpx.AsyncClient, documind: MockDocuMind, fake: FakeAnthropic
) -> None:
    dataset_id, v1_id = await published(
        [
            CaseFields(case_key="g1", type="single_hop", question="How long is a PIP?",
                       expected_doc_codes=["SIM-HR-001"], expected_sections=["SIM-HR-001 §2.4"]),
            CaseFields(case_key="g2", type="jurisdiction", question="Sick pay in Berlin?",
                       expected_doc_codes=["SIM-HR-102"], expected_jurisdiction="DE"),
            CaseFields(case_key="g3", type="out_of_scope", question="Best pizza?",
                       expected_behavior="refuse"),
        ]
    )  # fmt: skip
    batch = await create(api, kind="enrichment", dataset_version_id=str(v1_id))
    assert batch["candidate_count"] == 2
    assert batch["config"]["skipped"] == [{"case_key": "g3", "reason": "no_expected_documents"}]
    await drain()
    rows = {c["target_case_key"]: c for c in await candidates_of(api, batch["id"])}
    assert rows["g1"]["source_excerpt"][0]["section_number"] == "2.4"
    assert rows["g1"]["reference_answer"] == "The plan lasts 90 days."
    assert rows["g1"]["question"] == "How long is a PIP?"
    # g2 names no section: its excerpt was retrieved within its expected document.
    assert documind.retrieve_bodies[-1]["document_ids"] == [doc_id("SIM-HR-102")]
    assert rows["g2"]["source_excerpt"][0]["role"] == "retrieved"
    assert all(r["status"] == "pending" for r in rows.values())
    locked = await api.patch(f"/v1/candidates/{rows['g1']['id']}", json={"question": "Other?"})
    assert locked.status_code == 422

    for row in rows.values():
        await api.post(f"/v1/candidates/{row['id']}/approve")
    out = (await api.post(f"/v1/synthetic-batches/{batch['id']}/commit")).json()
    assert (out["added"], out["updated"]) == (0, 2)
    cases = {
        c["case_key"]: c
        for c in (await api.get(f"/v1/dataset-versions/{out['version']['id']}/cases")).json()[
            "cases"
        ]
    }
    assert cases["g1"]["reference_answer"] == "The plan lasts 90 days."
    assert cases["g1"]["key_facts"] == [{"fact": "It lasts 90 days.", "weight": 3.0}]
    assert cases["g3"]["reference_answer"] is None
    v1_cases = (await api.get(f"/v1/dataset-versions/{v1_id}/cases")).json()["cases"]
    assert all(c["reference_answer"] is None for c in v1_cases)


async def test_batch_validation(api: httpx.AsyncClient, documind: MockDocuMind) -> None:
    assert (await api.post("/v1/synthetic-batches", json={"type_counts": {}})).status_code == 422
    no_org = await api.post("/v1/synthetic-batches", json={"type_counts": {"single_hop": 1}})
    assert no_org.status_code == 422 and no_org.json()["error"]["code"] == "org_required"
    unknown = await api.post(
        "/v1/synthetic-batches",
        json={"org_slug": "simtora", "type_counts": {"single_hop": 1}, "document_ids": ["nope"]},
    )
    assert unknown.json()["error"]["code"] == "unknown_documents"
    enrichment = await api.post("/v1/synthetic-batches", json={"kind": "enrichment"})
    assert enrichment.status_code == 422
    no_seeds = await api.post(
        "/v1/synthetic-batches",
        json={"org_slug": "simtora", "type_counts": {"comparative": 2},
              "document_ids": [doc_id("SIM-IT-001")]},
    )  # fmt: skip
    assert no_seeds.json()["error"]["code"] == "no_candidates"


def test_doc_id_pattern() -> None:
    assert re.match(r"^doc-sim-hr-\d{3}$", doc_id("SIM-HR-001"))
