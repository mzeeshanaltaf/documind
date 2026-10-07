"""What an org's corpus contains, for the router prompt: departments, jurisdictions and one
line per searchable document. Cached in memory per org for 5 minutes; document create, edit,
delete and (re)indexing invalidate it.

"Searchable" means indexed at least once (`indexed_at IS NOT NULL`), not `status='ready'`: a
document being re-indexed is `processing` but its old chunks are still searched.
"""

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.document import Document

TTL_S = 300.0


@dataclass(frozen=True)
class CatalogDoc:
    id: uuid.UUID
    doc_code: str | None
    title: str
    department: str | None
    jurisdiction: str | None
    doc_type: str | None
    owner: str | None
    applies_to: str | None
    summary: str | None


@dataclass(frozen=True)
class Catalog:
    org_id: str
    departments: tuple[str, ...]
    jurisdictions: tuple[str, ...]
    documents: tuple[CatalogDoc, ...]

    def by_id(self) -> dict[uuid.UUID, CatalogDoc]:
        return {doc.id: doc for doc in self.documents}

    def jurisdictions_for(self, departments: list[str]) -> set[str]:
        return {
            doc.jurisdiction
            for doc in self.documents
            if doc.jurisdiction and (not departments or doc.department in departments)
        }

    def owners_for(self, departments: list[str]) -> list[str]:
        """Distinct `doc_code: owner` lines (all docs when no department was routed)."""
        lines = [
            f"{doc.doc_code or doc.title}: {doc.owner}"
            for doc in self.documents
            if doc.owner and (not departments or doc.department in departments)
        ]
        return list(dict.fromkeys(lines))

    def render(self) -> str:
        """The catalog as stable prompt text (same order every time, for prompt caching)."""
        lines = [
            f"Departments: {', '.join(self.departments) or '(none)'}",
            f"Jurisdictions: {', '.join(self.jurisdictions) or '(none)'}",
            "Documents:",
        ]
        for doc in self.documents:
            head = " | ".join(
                part
                for part in (
                    doc.doc_code,
                    doc.title,
                    doc.department,
                    doc.jurisdiction,
                    doc.doc_type,
                )
                if part
            )
            lines.append(f"- {head}")
            if doc.applies_to:
                lines.append(f"  Applies to: {_one_line(doc.applies_to)}")
            if doc.summary:
                lines.append(f"  Summary: {_one_line(doc.summary)}")
        return "\n".join(lines)


def _one_line(value: str) -> str:
    return " ".join(value.split())


_cache: dict[str, tuple[float, Catalog]] = {}


def invalidate(org_id: str | None = None) -> None:
    if org_id is None:
        _cache.clear()
    else:
        _cache.pop(org_id, None)


async def load_catalog(session: AsyncSession, org_id: str) -> Catalog:
    rows = (
        (
            await session.execute(
                select(Document)
                .where(Document.org_id == org_id, Document.indexed_at.is_not(None))
                .order_by(Document.department.nulls_last(), Document.doc_code, Document.title)
            )
        )
        .scalars()
        .all()
    )
    documents = tuple(
        CatalogDoc(
            id=row.id,
            doc_code=row.doc_code,
            title=row.title,
            department=row.department,
            jurisdiction=row.jurisdiction,
            doc_type=row.doc_type,
            owner=row.owner,
            applies_to=row.applies_to,
            summary=row.summary,
        )
        for row in rows
    )
    return Catalog(
        org_id=org_id,
        departments=tuple(sorted({d.department for d in documents if d.department})),
        jurisdictions=tuple(sorted({d.jurisdiction for d in documents if d.jurisdiction})),
        documents=documents,
    )


async def get_org_catalog(org_id: str) -> Catalog:
    cached = _cache.get(org_id)
    now = time.monotonic()
    if cached and cached[0] > now:
        return cached[1]
    async with SessionLocal() as session:
        catalog = await load_catalog(session, org_id)
    _cache[org_id] = (now + TTL_S, catalog)
    return catalog
