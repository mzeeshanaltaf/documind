"""DB-backed ingestion queue: claim a job (`FOR UPDATE SKIP LOCKED`), run the pipeline, record
the outcome. Safe to run in several loops/processes; a job whose lock is older than 15 minutes
(crashed worker) is reclaimed. Each stage refreshes the lock, so slow jobs aren't stolen.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from anyio import to_thread
from sqlalchemy import text, update

from app.core import storage
from app.core.db import session_scope
from app.ingestion.chunker import EmbedContext, chunk_document
from app.ingestion.indexer import embed_chunks, write_index
from app.ingestion.metadata import DocumentMetadata, extract_metadata
from app.ingestion.parser import parse_pdf
from app.llm.usage import UsageCtx
from app.models.document import Document, IngestionJob
from app.services.org_settings import effective_settings

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 2.0
MAX_ATTEMPTS = 3
ERROR_MAX_CHARS = 2000

_CLAIM_SQL = """
UPDATE ingestion_jobs
SET status = 'running', locked_at = now(), started_at = coalesce(started_at, now()),
    attempts = attempts + 1
WHERE id = (
    SELECT id FROM ingestion_jobs
    WHERE (status = 'queued'
           OR (status = 'running' AND locked_at < now() - interval '15 minutes'))
    {org_filter}
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, document_id, org_id, attempts
"""
CLAIM = text(_CLAIM_SQL.format(org_filter=""))
CLAIM_FOR_ORG = text(_CLAIM_SQL.format(org_filter="AND org_id = :org_id"))


class DocumentGone(Exception):
    """The document was deleted while its job was queued or running."""


@dataclass(frozen=True)
class ClaimedJob:
    id: uuid.UUID
    document_id: uuid.UUID
    org_id: str
    attempts: int


async def claim_job(org_id: str | None = None) -> ClaimedJob | None:
    async with session_scope() as session:
        if org_id:
            result = await session.execute(CLAIM_FOR_ORG, {"org_id": org_id})
        else:
            result = await session.execute(CLAIM)
        row = result.one_or_none()
    return ClaimedJob(row.id, row.document_id, row.org_id, row.attempts) if row else None


async def set_stage(job_id: uuid.UUID, stage: str, progress: int) -> None:
    async with session_scope() as session:
        await session.execute(
            update(IngestionJob)
            .where(IngestionJob.id == job_id)
            .values(stage=stage, progress=progress, locked_at=datetime.now(UTC))
        )


def _metadata_from_document(doc: Document) -> DocumentMetadata:
    return DocumentMetadata(
        title=doc.title,
        legal_entity=doc.legal_entity,
        doc_code=doc.doc_code,
        department=doc.department,
        jurisdiction=doc.jurisdiction,
        doc_type=doc.doc_type,
        version=doc.version,
        effective_date=doc.effective_date,
        review_cycle=doc.review_cycle,
        owner=doc.owner,
        approved_by=doc.approved_by,
        applies_to=doc.applies_to,
        related_doc_codes=list(doc.related_doc_codes or []),
        summary=doc.summary,
    )


async def _read_pdf(file_key: str) -> bytes:
    stream = await storage.open_stream(file_key)
    return await to_thread.run_sync(lambda: b"".join(stream.iterator))


async def run_pipeline(job: ClaimedJob) -> int:
    """Download → parse → metadata → chunk → embed → index. Returns the chunk count."""
    async with session_scope() as session:
        doc = await session.get(Document, job.document_id)
        if doc is None:
            raise DocumentGone(str(job.document_id))
        doc.status, doc.error = "processing", None
        settings = await effective_settings(session, job.org_id)
        file_key, file_name, user_id = doc.file_key, doc.file_name or "", doc.uploaded_by
        # Reindex keeps stored metadata (admins may have edited it); first ingestion derives it.
        existing = _metadata_from_document(doc) if doc.indexed_at else None

    await set_stage(job.id, "downloading", 5)
    data = await _read_pdf(file_key)

    await set_stage(job.id, "parsing", 20)
    parsed = await to_thread.run_sync(parse_pdf, data)
    if not parsed.blocks:
        raise ValueError("No extractable text found (is this a scanned PDF?)")

    await set_stage(job.id, "metadata", 35)
    if existing and existing.department and existing.jurisdiction and existing.doc_type:
        meta = existing
    else:
        meta = await extract_metadata(
            parsed,
            file_name,
            model=settings.router_model,
            tier=settings.background_service_tier,
            org_id=job.org_id,
            document_id=job.document_id,
            user_id=user_id,
        )

    await set_stage(job.id, "chunking", 50)
    ctx = EmbedContext(meta.doc_code, meta.title, meta.version, meta.jurisdiction, meta.department)
    drafts = await to_thread.run_sync(chunk_document, parsed, ctx)
    if not drafts:
        raise ValueError("The document produced no chunks")

    await set_stage(job.id, "embedding", 60)

    async def embedding_progress(done: int, total: int) -> None:
        await set_stage(job.id, "embedding", 60 + round(30 * done / total))

    embeddings = await embed_chunks(
        drafts,
        UsageCtx(org_id=job.org_id, user_id=user_id, document_id=job.document_id),
        on_progress=embedding_progress,
    )

    await set_stage(job.id, "indexing", 95)
    fields: dict[str, Any] = {
        **meta.as_dict(),
        "page_count": parsed.pages,
        "outline": parsed.outline,
    }
    async with session_scope() as session:
        if await session.get(Document, job.document_id) is None:
            raise DocumentGone(str(job.document_id))
        count = await write_index(
            session,
            document_id=job.document_id,
            org_id=job.org_id,
            drafts=drafts,
            embeddings=embeddings,
            document_fields=fields,
        )
        await session.execute(
            update(IngestionJob)
            .where(IngestionJob.id == job.id)
            .values(
                status="succeeded",
                stage="done",
                progress=100,
                error=None,
                finished_at=datetime.now(UTC),
            )
        )
    return count


async def _record_failure(job: ClaimedJob, exc: BaseException) -> None:
    message = f"{type(exc).__name__}: {exc}"[:ERROR_MAX_CHARS]
    final = job.attempts >= MAX_ATTEMPTS
    async with session_scope() as session:
        await session.execute(
            update(IngestionJob)
            .where(IngestionJob.id == job.id)
            .values(
                status="failed" if final else "queued",
                error=message,
                locked_at=None,
                finished_at=datetime.now(UTC) if final else None,
            )
        )
        await session.execute(
            update(Document)
            .where(Document.id == job.document_id)
            .values(status="failed" if final else "processing", error=message)
        )


async def process_job(job: ClaimedJob) -> bool:
    """Run one claimed job and record the outcome. Returns True on success."""
    if job.attempts > MAX_ATTEMPTS:  # a stale lock reclaimed after the last attempt
        await _record_failure(job, RuntimeError("Gave up after repeated interruptions"))
        return False
    started = asyncio.get_running_loop().time()
    try:
        count = await run_pipeline(job)
    except DocumentGone:
        logger.info("Document %s was deleted; dropping job %s", job.document_id, job.id)
        return False
    except Exception as exc:
        logger.exception("Ingestion job %s (attempt %d) failed", job.id, job.attempts)
        try:
            await _record_failure(job, exc)
        except Exception:
            logger.exception("Could not record failure for job %s", job.id)
        return False
    elapsed = asyncio.get_running_loop().time() - started
    logger.info("Indexed document %s: %d chunks in %.1fs", job.document_id, count, elapsed)
    return True


async def run(stop: asyncio.Event | None = None) -> None:
    """Worker loop for the API lifespan: process jobs until `stop` is set."""
    stop = stop or asyncio.Event()
    while not stop.is_set():
        try:
            job = await claim_job()
        except Exception:
            logger.exception("Claiming an ingestion job failed")
            job = None
        if job:
            await process_job(job)
            continue
        try:
            await asyncio.wait_for(stop.wait(), timeout=POLL_INTERVAL_S)
        except TimeoutError:
            pass


async def run_until_idle(concurrency: int = 1, org_id: str | None = None) -> int:
    """Process claimable jobs inline (scripts, tests) until none are left. Returns successes."""
    succeeded = 0

    async def loop() -> None:
        nonlocal succeeded
        while job := await claim_job(org_id):
            succeeded += await process_job(job)

    await asyncio.gather(*(loop() for _ in range(max(1, concurrency))))
    return succeeded
