"""Cosine similarity search over the HNSW index (pgvector 0.8).

Filters (org, documents, departments) run inside the index scan with `iterative_scan =
relaxed_order`, so a selective filter still returns k rows. Relaxed order can return rows
slightly out of order, so the top k are re-sorted by distance afterwards.
"""

import uuid
from collections.abc import Sequence

from pgvector.sqlalchemy import Vector
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import EMBEDDING_DIM

EF_SEARCH = 100

# set_config(..., is_local => true) == SET LOCAL, in one round trip.
SESSION_SETTINGS = text(
    "SELECT set_config('hnsw.ef_search', :ef, true),"
    " set_config('hnsw.iterative_scan', 'relaxed_order', true)"
)

VECTOR_SQL = text(
    """
    WITH r AS MATERIALIZED (
      SELECT id, embedding <=> :qvec AS dist FROM chunks
      WHERE org_id = :org
        AND (CAST(:doc_ids AS uuid[]) IS NULL OR document_id = ANY(CAST(:doc_ids AS uuid[])))
        AND (CAST(:depts AS text[]) IS NULL OR department = ANY(CAST(:depts AS text[])))
      ORDER BY embedding <=> :qvec
      LIMIT :k)
    SELECT id, 1 - dist AS sim FROM r ORDER BY dist, id
    """
).bindparams(bindparam("qvec", type_=Vector(EMBEDDING_DIM)))


async def vector_search(
    session: AsyncSession,
    org_id: str,
    query_vector: Sequence[float],
    *,
    k: int = 30,
    document_ids: Sequence[uuid.UUID] | None = None,
    departments: Sequence[str] | None = None,
) -> list[tuple[uuid.UUID, float]]:
    """Top-k `(chunk_id, cosine similarity)`, most similar first. Uses the session's current
    transaction for the SET LOCALs, so give each concurrent search its own session."""
    await session.execute(SESSION_SETTINGS, {"ef": str(EF_SEARCH)})
    rows = await session.execute(
        VECTOR_SQL,
        {
            "qvec": list(query_vector),
            "org": org_id,
            "doc_ids": list(document_ids) if document_ids else None,
            "depts": list(departments) if departments else None,
            "k": k,
        },
    )
    return [(row.id, float(row.sim)) for row in rows]
