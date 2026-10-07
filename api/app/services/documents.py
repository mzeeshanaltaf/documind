"""Document lifecycle: upload → queue, list/read, metadata edits, reindex, delete.

Shared by the documents router and `scripts/seed_policies.py`.
"""

import hashlib
import logging
import os
import tempfile
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from anyio import to_thread
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.agents import catalog
from app.core import storage
from app.ingestion.indexer import refresh_bm25_stats
from app.models.document import Chunk, Document, IngestionJob

logger = logging.getLogger(__name__)

PDF_MAGIC = b"%PDF-"
MAGIC_WINDOW = 1024  # the PDF spec tolerates a few junk bytes before the header
READ_CHUNK = 1024 * 1024
ACTIVE_JOB_STATUSES = ("queued", "running")
# Fields that feed each chunk's contextual header (`embed_text`): changing them needs a reindex.
EMBED_FIELDS = frozenset({"doc_code", "title", "version", "jurisdiction", "department"})
# Fields copied onto every chunk for filtering: updated in place on edit.
DENORMALIZED_FIELDS = ("department", "jurisdiction", "doc_type")


class DuplicateDocument(Exception):
    def __init__(self, existing_id: uuid.UUID) -> None:
        super().__init__(f"Document already uploaded as {existing_id}")
        self.existing_id = existing_id


class InvalidUpload(Exception):
    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason  # not_pdf | too_large | empty


class AsyncReadable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


@dataclass(frozen=True)
class SpooledFile:
    path: Path
    size: int
    sha256: str


@asynccontextmanager
async def spool_upload(source: AsyncReadable, max_bytes: int) -> AsyncIterator[SpooledFile]:
    """Stream an upload to a temp file while hashing it and enforcing type and size limits."""
    fd, name = tempfile.mkstemp(prefix="documind-", suffix=".pdf")
    path = Path(name)
    try:
        digest, size, head = hashlib.sha256(), 0, b""
        with os.fdopen(fd, "wb") as out:
            while chunk := await source.read(READ_CHUNK):
                if len(head) < MAGIC_WINDOW:
                    head += chunk[: MAGIC_WINDOW - len(head)]
                    if len(head) >= MAGIC_WINDOW and PDF_MAGIC not in head:
                        raise InvalidUpload("not_pdf", "Only PDF files are accepted.")
                size += len(chunk)
                if size > max_bytes:
                    raise InvalidUpload(
                        "too_large", f"The file exceeds the {max_bytes // (1024 * 1024)} MB limit."
                    )
                digest.update(chunk)
                await to_thread.run_sync(out.write, chunk)
        if size == 0:
            raise InvalidUpload("empty", "The file is empty.")
        if PDF_MAGIC not in head:
            raise InvalidUpload("not_pdf", "Only PDF files are accepted.")
        yield SpooledFile(path, size, digest.hexdigest())
    finally:
        await to_thread.run_sync(lambda: path.unlink(missing_ok=True))


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(READ_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def placeholder_title(file_name: str) -> str:
    return Path(file_name).stem.replace("-", " ").replace("_", " ").strip() or "Untitled document"


async def find_by_sha(session: AsyncSession, org_id: str, sha256: str) -> Document | None:
    return (
        await session.execute(
            select(Document).where(Document.org_id == org_id, Document.sha256 == sha256)
        )
    ).scalar_one_or_none()


async def create_document(
    session: AsyncSession,
    *,
    org_id: str,
    uploaded_by: str | None,
    file_name: str,
    file: SpooledFile,
) -> tuple[Document, IngestionJob]:
    """Store the PDF in MinIO, insert the document + a queued job, and commit.
    Raises DuplicateDocument if the org already has a file with the same sha256."""
    existing = await find_by_sha(session, org_id, file.sha256)
    if existing:
        raise DuplicateDocument(existing.id)

    document_id = uuid.uuid4()
    key = storage.document_key(org_id, str(document_id))
    with file.path.open("rb") as handle:
        await storage.put_pdf(key, handle, file.size)

    document = Document(
        id=document_id,
        org_id=org_id,
        title=placeholder_title(file_name),
        file_key=key,
        file_name=file_name,
        file_size=file.size,
        sha256=file.sha256,
        status="uploaded",
        uploaded_by=uploaded_by,
    )
    job = IngestionJob(document_id=document_id, org_id=org_id, status="queued", stage="queued")
    session.add(document)
    try:
        await session.flush()  # the job's FK needs the document row first
        session.add(job)
        await session.commit()
        catalog.invalidate(org_id)
    except IntegrityError:
        await session.rollback()
        await _delete_object(key)
        raced = await find_by_sha(session, org_id, file.sha256)
        if raced:
            raise DuplicateDocument(raced.id) from None
        raise
    except BaseException:
        await session.rollback()
        await _delete_object(key)
        raise
    return document, job


async def _delete_object(key: str) -> None:
    try:
        await storage.delete(key)
    except Exception:
        logger.exception("Could not delete stored object %s", key)


def _latest_jobs(org_id: str) -> Any:
    return (
        select(IngestionJob)
        .where(IngestionJob.org_id == org_id)
        .ext(distinct_on(IngestionJob.document_id))
        .order_by(IngestionJob.document_id, IngestionJob.created_at.desc())
        .subquery()
    )


async def list_documents(
    session: AsyncSession,
    org_id: str,
    *,
    status: str | None = None,
    department: str | None = None,
    q: str | None = None,
) -> list[tuple[Document, IngestionJob | None, int]]:
    """Documents with their latest job and chunk count, ordered by department then title."""
    latest = aliased(IngestionJob, _latest_jobs(org_id))
    counts = (
        select(Chunk.document_id, func.count().label("n"))
        .where(Chunk.org_id == org_id)
        .group_by(Chunk.document_id)
        .subquery()
    )
    query = (
        select(Document, latest, func.coalesce(counts.c.n, 0))
        .outerjoin(latest, latest.document_id == Document.id)
        .outerjoin(counts, counts.c.document_id == Document.id)
        .where(Document.org_id == org_id)
        .order_by(Document.department.nulls_last(), Document.title)
    )
    if status:
        query = query.where(Document.status == status)
    if department:
        query = query.where(Document.department == department)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.where(Document.title.ilike(pattern) | Document.doc_code.ilike(pattern))
    rows = (await session.execute(query)).all()
    return [(row[0], row[1], row[2]) for row in rows]


async def get_document(
    session: AsyncSession, org_id: str, document_id: uuid.UUID
) -> Document | None:
    document = await session.get(Document, document_id)
    return document if document and document.org_id == org_id else None


async def latest_job(session: AsyncSession, document_id: uuid.UUID) -> IngestionJob | None:
    return (
        await session.execute(
            select(IngestionJob)
            .where(IngestionJob.document_id == document_id)
            .order_by(IngestionJob.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def chunk_count(session: AsyncSession, document_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(Chunk).where(Chunk.document_id == document_id)
        )
    ).scalar_one()


async def update_metadata(
    session: AsyncSession, document: Document, changes: dict[str, Any]
) -> bool:
    """Apply metadata edits, sync the chunks' denormalized columns, and commit.
    Returns True if a field used in `embed_text` changed (the document needs a reindex)."""
    changed = {key: value for key, value in changes.items() if getattr(document, key) != value}
    for key, value in changed.items():
        setattr(document, key, value)
    synced = {key: changed[key] for key in DENORMALIZED_FIELDS if key in changed}
    if synced:
        await session.execute(
            update(Chunk).where(Chunk.document_id == document.id).values(**synced)
        )
    await session.commit()
    catalog.invalidate(document.org_id)
    await session.refresh(document)
    return bool(EMBED_FIELDS & changed.keys())


async def enqueue_reindex(session: AsyncSession, document: Document) -> IngestionJob:
    """Queue a fresh ingestion job (existing chunks stay searchable until it finishes).
    Returns the already-active job instead if one is queued or running."""
    active = (
        await session.execute(
            select(IngestionJob)
            .where(
                IngestionJob.document_id == document.id,
                IngestionJob.status.in_(ACTIVE_JOB_STATUSES),
            )
            .order_by(IngestionJob.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if active:
        return active
    job = IngestionJob(
        document_id=document.id, org_id=document.org_id, status="queued", stage="queued"
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def delete_document(session: AsyncSession, document: Document) -> None:
    """Delete the rows (chunks, postings and jobs cascade), refresh BM25 stats, then the file."""
    key, org_id = document.file_key, document.org_id
    await session.delete(document)
    await session.flush()
    await refresh_bm25_stats(session, org_id)
    await session.commit()
    catalog.invalidate(org_id)
    await _delete_object(key)
