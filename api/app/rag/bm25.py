"""Okapi BM25 (k1=1.2, b=0.75) computed in SQL over the `chunk_terms` inverted index.

idf = ln(1 + (N - df + 0.5) / (df + 0.5)) (always positive, as in Lucene), with N and the
average length from `bm25_stats`. Query terms come from the same tokenizer as indexing; each
distinct term counts once (query term frequency is ignored).
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from app.rag.tokenizer import term_freqs

K1 = 1.2
B = 0.75

# k1/b are cast explicitly: in `:k1 + 1` Postgres would otherwise infer an integer parameter.
BM25_SQL = text(
    """
    WITH q(term) AS (SELECT unnest(CAST(:terms AS text[]))),
    p AS (SELECT CAST(:k1 AS float8) AS k1, CAST(:b AS float8) AS b),
    s AS (SELECT n_chunks, avg_len FROM bm25_stats WHERE org_id = :org),
    df AS (SELECT ct.term, count(*)::float AS df
           FROM chunk_terms ct JOIN q USING (term)
           WHERE ct.org_id = :org GROUP BY ct.term)
    SELECT ct.chunk_id,
           sum( ln(1 + (s.n_chunks - df.df + 0.5) / (df.df + 0.5))
                * (ct.tf * (p.k1 + 1))
                / (ct.tf + p.k1 * (1 - p.b + p.b * c.bm25_len / s.avg_len)) ) AS score
    FROM chunk_terms ct
    JOIN q USING (term) JOIN df USING (term)
    JOIN chunks c ON c.id = ct.chunk_id
    CROSS JOIN s CROSS JOIN p
    WHERE ct.org_id = :org
      AND (CAST(:doc_ids AS uuid[]) IS NULL OR c.document_id = ANY(CAST(:doc_ids AS uuid[])))
      AND (CAST(:depts AS text[]) IS NULL OR c.department = ANY(CAST(:depts AS text[])))
    GROUP BY ct.chunk_id
    ORDER BY score DESC, ct.chunk_id
    LIMIT :k
    """
)


def query_terms(query: str) -> list[str]:
    return sorted(term_freqs(query))


async def bm25_search(
    db: AsyncSession | AsyncConnection,
    org_id: str,
    query: str,
    *,
    k: int = 30,
    document_ids: Sequence[uuid.UUID] | None = None,
    departments: Sequence[str] | None = None,
) -> list[tuple[uuid.UUID, float]]:
    """Top-k `(chunk_id, score)` for the query, best first. Empty if no query term matches."""
    terms = query_terms(query)
    if not terms:
        return []
    rows = await db.execute(
        BM25_SQL,
        {
            "terms": terms,
            "org": org_id,
            "k1": K1,
            "b": B,
            "doc_ids": list(document_ids) if document_ids else None,
            "depts": list(departments) if departments else None,
            "k": k,
        },
    )
    return [(row.chunk_id, float(row.score)) for row in rows]
