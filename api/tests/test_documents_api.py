"""Documents API + ingestion pipeline against the dev DB and local MinIO (OpenAI is faked)."""

import hashlib
import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from botocore.exceptions import ClientError
from httpx import AsyncClient
from sqlalchemy import text

from app.core import storage
from app.core.db import engine
from app.ingestion import worker
from app.llm import client as llm_client
from tests.conftest import Seed
from tests.policies import POLICIES_DIR

PDF = POLICIES_DIR / "HR-Germany-Manual.pdf"


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.output_text = json.dumps(payload)
        self.usage = None
        self.service_tier = "flex"


async def _fake_respond(**kwargs: Any) -> tuple[_FakeResponse, None]:
    if kwargs["text_format"]["name"] == "document_classification":
        payload = {
            "department": "HR",
            "jurisdiction": "DE",
            "doc_type": "country_supplement",
            "title": None,
            "legal_entity": None,
        }
    else:
        payload = {"summary": "Local HR rules for Simtora Technologies GmbH employees."}
    return _FakeResponse(payload), None


async def _fake_embed(texts: list[str], **kwargs: Any) -> list[list[float]]:
    vectors = []
    for value in texts:
        seed = hashlib.sha256(value.encode()).digest()
        vectors.append([(seed[i % 32] + 1) / 256 for i in range(1536)])
    if kwargs.get("on_progress"):
        await kwargs["on_progress"](len(texts), len(texts))
    return vectors


@pytest.fixture
async def fake_openai(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    monkeypatch.setattr(llm_client, "respond", _fake_respond)
    monkeypatch.setattr(llm_client, "embed", _fake_embed)
    yield


async def _scalar(sql: str, **params: Any) -> Any:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).scalar()


async def _object_exists(key: str) -> bool:
    try:
        stream = await storage.open_stream(key)
    except ClientError:
        return False
    stream.iterator.close()  # type: ignore[attr-defined]
    return True


def _upload(name: str, data: bytes) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files[]", (name, data, "application/pdf"))]


async def test_document_lifecycle(
    client: AsyncClient, api_key: str, seed: Seed, fake_openai: None
) -> None:
    admin = {"X-API-Key": api_key, "X-User-Id": seed.admin_id}
    member = {"X-API-Key": api_key, "X-User-Id": seed.member_id}
    base = f"/v1/orgs/{seed.org_id}/documents"
    pdf = PDF.read_bytes()
    file_key = None
    try:
        # Uploads: admin only, PDFs only, no duplicates.
        response = await client.post(base, headers=member, files=_upload("x.pdf", pdf))
        assert response.status_code == 403
        response = await client.post(base, headers=admin, files=_upload("x.pdf", b"hello"))
        assert response.status_code == 415
        assert response.json()["error"]["code"] == "not_pdf"

        response = await client.post(base, headers=admin, files=_upload(PDF.name, pdf))
        assert response.status_code == 202, response.text
        item = response.json()["documents"][0]
        assert item["status"] == "queued"
        doc_id = item["document_id"]
        file_key = storage.document_key(seed.org_id, doc_id)
        assert await _object_exists(file_key)

        response = await client.post(base, headers=admin, files=_upload("copy.pdf", pdf))
        assert response.status_code == 409
        assert response.json()["error"]["details"]["existing_id"] == doc_id

        # Members can list; the latest job is included.
        listing = (await client.get(base, headers=member)).json()["documents"]
        assert [d["id"] for d in listing] == [doc_id]
        assert listing[0]["status"] == "uploaded"
        assert listing[0]["job"]["status"] == "queued"

        # Process the queue inline.
        assert await worker.run_until_idle(org_id=seed.org_id) == 1

        detail = (await client.get(f"{base}/{doc_id}", headers=member)).json()
        assert detail["status"] == "ready"
        assert detail["doc_code"] == "SIM-HR-102"
        assert detail["title"] == "Germany HR Manual (Berlin)"
        assert detail["legal_entity"] == "Simtora Technologies GmbH"
        assert (detail["department"], detail["jurisdiction"]) == ("HR", "DE")
        assert detail["effective_date"] == "2026-10-05"
        assert detail["page_count"] == 32
        assert detail["summary"].startswith("Local HR rules")
        assert any(entry["number"] == "1.1" for entry in detail["outline"])
        assert detail["job"]["status"] == "succeeded" and detail["job"]["progress"] == 100
        chunks = detail["chunk_count"]
        assert chunks > 20

        # BM25 postings and corpus stats.
        assert await _scalar(
            "SELECT count(*) FROM chunk_terms WHERE org_id = :org", org=seed.org_id
        )
        assert (
            await _scalar("SELECT n_chunks FROM bm25_stats WHERE org_id = :org", org=seed.org_id)
            == chunks
        )
        assert (
            await _scalar(
                "SELECT count(*) FROM chunks WHERE org_id = :org AND jurisdiction = 'DE'"
                " AND embedding IS NOT NULL AND bm25_len > 0",
                org=seed.org_id,
            )
            == chunks
        )

        # The file streams back as an inline PDF.
        response = await client.get(f"{base}/{doc_id}/file", headers=member)
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("inline;")
        assert response.headers["cache-control"] == "private, max-age=300"
        assert response.content == pdf

        job = (await client.get(f"{base}/{doc_id}/job", headers=member)).json()
        assert job["status"] == "succeeded"

        # Metadata edits: filters sync to chunks at once; header fields ask for a reindex.
        response = await client.patch(
            f"{base}/{doc_id}", headers=admin, json={"department": "Legal"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["needs_reindex"] is True
        assert (
            await _scalar(
                "SELECT count(*) FROM chunks WHERE document_id = :d AND department = 'Legal'",
                d=doc_id,
            )
            == chunks
        )
        response = await client.patch(
            f"{base}/{doc_id}", headers=admin, json={"doc_type": "procedure"}
        )
        assert response.json()["needs_reindex"] is False
        response = await client.patch(
            f"{base}/{doc_id}", headers=admin, json={"jurisdiction": "UK"}
        )
        assert response.json()["jurisdiction"] == "GB"
        response = await client.patch(
            f"{base}/{doc_id}", headers=admin, json={"jurisdiction": "XYZ"}
        )
        assert response.status_code == 422
        response = await client.patch(f"{base}/{doc_id}", headers=member, json={"title": "X"})
        assert response.status_code == 403

        # Reindex keeps the edited metadata and rewrites the contextual headers.
        first = await client.post(f"{base}/{doc_id}/reindex", headers=admin)
        assert first.status_code == 202
        again = await client.post(f"{base}/{doc_id}/reindex", headers=admin)
        assert again.json()["id"] == first.json()["id"]  # already queued
        assert await worker.run_until_idle(org_id=seed.org_id) == 1
        assert (
            await _scalar(
                "SELECT count(*) FROM chunks WHERE document_id = :d AND embed_text LIKE :header",
                d=doc_id,
                header="[SIM-HR-102 · Germany HR Manual (Berlin) v1.0 · GB · Legal%",
            )
            == chunks
        )

        # Delete removes rows, postings and the stored file, and refreshes stats.
        response = await client.delete(f"{base}/{doc_id}", headers=member)
        assert response.status_code == 403
        response = await client.delete(f"{base}/{doc_id}", headers=admin)
        assert response.status_code == 204
        assert (await client.get(f"{base}/{doc_id}", headers=admin)).status_code == 404
        assert not await _object_exists(file_key)
        assert await _scalar("SELECT count(*) FROM chunks WHERE org_id = :o", o=seed.org_id) == 0
        assert (
            await _scalar("SELECT count(*) FROM chunk_terms WHERE org_id = :o", o=seed.org_id) == 0
        )
        assert (
            await _scalar("SELECT n_chunks FROM bm25_stats WHERE org_id = :o", o=seed.org_id) == 0
        )
    finally:
        if file_key:
            await storage.delete(file_key)


async def test_outsider_cannot_see_documents(client: AsyncClient, api_key: str, seed: Seed) -> None:
    headers = {"X-API-Key": api_key, "X-User-Id": seed.outsider_id}
    response = await client.get(f"/v1/orgs/{seed.org_id}/documents", headers=headers)
    assert response.status_code == 404
