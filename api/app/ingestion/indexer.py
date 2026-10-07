"""Write a document's chunks, embeddings and BM25 postings in one transaction."""

import uuid
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, insert, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.ingestion.chunker import ChunkDraft
from app.llm import client as llm
from app.llm.usage import UsageCtx
from app.models.document import Chunk, Document
from app.rag.tokenizer import term_freqs

INSERT_BATCH = 200

REFRESH_BM25_STATS = text(
    """
    INSERT INTO bm25_stats (org_id, n_chunks, avg_len, updated_at)
    SELECT :org_id, count(*), coalesce(avg(bm25_len), 0), now()
    FROM chunks WHERE org_id = :org_id
    ON CONFLICT (org_id) DO UPDATE
    SET n_chunks = EXCLUDED.n_chunks, avg_len = EXCLUDED.avg_len, updated_at = now()
    """
)


async def refresh_bm25_stats(session: AsyncSession, org_id: str) -> None:
    """Recompute the org's corpus stats (N, average length); run after any chunk change."""
    await session.execute(REFRESH_BM25_STATS, {"org_id": org_id})


async def embed_chunks(
    drafts: Sequence[ChunkDraft],
    ctx: UsageCtx,
    on_progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> list[list[float]]:
    return await llm.embed(
        [draft.embed_text for draft in drafts],
        operation="embed_ingest",
        ctx=ctx,
        on_progress=on_progress,
    )


async def write_index(
    session: AsyncSession,
    *,
    document_id: uuid.UUID,
    org_id: str,
    drafts: Sequence[ChunkDraft],
    embeddings: Sequence[Sequence[float]],
    document_fields: dict[str, Any],
) -> int:
    """Replace the document's chunks and postings, refresh BM25 stats and mark it ready.
    Runs in the caller's transaction (commit afterwards). Returns the chunk count."""
    if len(drafts) != len(embeddings):
        raise ValueError("Each chunk needs exactly one embedding")

    denormalized = {
        "department": document_fields.get("department"),
        "jurisdiction": document_fields.get("jurisdiction"),
        "doc_type": document_fields.get("doc_type"),
    }
    rows: list[dict[str, Any]] = []
    postings: list[tuple[str, str, uuid.UUID, int]] = []
    for draft, embedding in zip(drafts, embeddings, strict=True):
        chunk_id = uuid.uuid4()
        freqs = term_freqs(draft.embed_text)
        rows.append(
            {
                "id": chunk_id,
                "document_id": document_id,
                "org_id": org_id,
                "chunk_index": draft.chunk_index,
                "text": draft.text,
                "embed_text": draft.embed_text,
                "section_path": draft.section_path,
                "section_number": draft.section_number,
                "section_title": draft.section_title,
                "page_start": draft.page_start,
                "page_end": draft.page_end,
                "content_type": draft.content_type,
                "token_count": draft.token_count,
                "cross_refs": draft.cross_refs,
                "embedding": list(embedding),
                "bm25_len": sum(freqs.values()),
                **denormalized,
            }
        )
        postings.extend((org_id, term, chunk_id, tf) for term, tf in freqs.items())

    # 1. Re-index: drop the old chunks (chunk_terms cascade).
    await session.execute(delete(Chunk).where(Chunk.document_id == document_id))
    # 2. Chunks with embeddings and denormalized filters.
    for start in range(0, len(rows), INSERT_BATCH):
        await session.execute(insert(Chunk), rows[start : start + INSERT_BATCH])
    # 3. Postings via COPY on the same connection (and transaction).
    if postings:
        connection = await session.connection()
        raw = await connection.get_raw_connection()
        await raw.driver_connection.copy_records_to_table(  # type: ignore[union-attr]
            "chunk_terms",
            records=postings,
            columns=["org_id", "term", "chunk_id", "tf"],
            schema_name=get_settings().db_schema,
        )
    # 4. Corpus stats for BM25.
    await refresh_bm25_stats(session, org_id)
    # 5. The document itself.
    await session.execute(
        update(Document)
        .where(Document.id == document_id)
        .values(
            **document_fields,
            status="ready",
            error=None,
            indexed_at=datetime.now(UTC),
        )
    )
    return len(rows)
