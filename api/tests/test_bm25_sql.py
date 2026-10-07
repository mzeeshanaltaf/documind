"""The SQL BM25 matches a pure-Python Okapi BM25 with the same idf, on a toy corpus inserted
under a throwaway org inside a transaction that is rolled back."""

import math
import uuid
from collections import Counter

from rank_bm25 import BM25Okapi
from sqlalchemy import text

from app.core.db import engine
from app.rag.bm25 import K1, B, bm25_search, query_terms
from app.rag.tokenizer import term_freqs

CORPUS = [
    ("HR", "Employees receive 30 working days of paid annual leave per calendar year."),
    ("HR", "Sick leave: employees keep full pay for six weeks of sickness, then sick pay."),
    ("HR", "Parental leave and Elternzeit: up to three years of unpaid leave per child."),
    ("IT", "Multi-factor authentication is required for every account; passwords rotate."),
    ("IT", "Approved AI tools may be used for work with internal data, never secrets."),
    ("Finance", "Expense reports are due within 30 days; leave travel receipts attached."),
    ("Facilities", "Visitors sign in at reception and wear a badge; annual visitor review."),
]
QUERIES = [
    "How many days of annual leave do employees get?",
    "sick pay and leave",
    "Can I use AI tools for work?",
    "visitor badge reception",
    "leave",
]


def reference_scores(docs: list[Counter[str]], query: str) -> list[float]:
    """Okapi BM25 with idf = ln(1 + (N - df + 0.5) / (df + 0.5)); query terms count once."""
    n = len(docs)
    avg_len = sum(sum(d.values()) for d in docs) / n
    terms = set(term_freqs(query))
    scores = []
    for doc in docs:
        length = sum(doc.values())
        score = 0.0
        for term in terms:
            tf = doc.get(term, 0)
            if not tf:
                continue
            df = sum(1 for d in docs if term in d)
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
            score += idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * length / avg_len))
        scores.append(score)
    return scores


async def _insert_corpus(conn, org_id: str) -> tuple[list[uuid.UUID], dict[str, uuid.UUID]]:
    await conn.execute(
        text(
            'INSERT INTO organization (id, name, slug, "createdAt") VALUES (:id, :id, :id, now())'
        ),
        {"id": org_id},
    )
    doc_ids: dict[str, uuid.UUID] = {}
    for department in {dept for dept, _ in CORPUS}:
        doc_ids[department] = uuid.uuid4()
        await conn.execute(
            text(
                "INSERT INTO documents (id, org_id, title, file_key, sha256, status, department)"
                " VALUES (:id, :org, :title, :key, :sha, 'ready', :dept)"
            ),
            {
                "id": doc_ids[department],
                "org": org_id,
                "title": department,
                "key": f"test/{department}",
                "sha": uuid.uuid4().hex,
                "dept": department,
            },
        )
    chunk_ids = []
    for index, (department, body) in enumerate(CORPUS):
        chunk_id = uuid.uuid4()
        freqs = term_freqs(body)
        await conn.execute(
            text(
                "INSERT INTO chunks (id, document_id, org_id, chunk_index, text, embed_text,"
                " department, bm25_len) VALUES (:id, :doc, :org, :idx, :t, :t, :dept, :len)"
            ),
            {
                "id": chunk_id,
                "doc": doc_ids[department],
                "org": org_id,
                "idx": index,
                "t": body,
                "dept": department,
                "len": sum(freqs.values()),
            },
        )
        for term, tf in freqs.items():
            await conn.execute(
                text(
                    "INSERT INTO chunk_terms (org_id, term, chunk_id, tf)"
                    " VALUES (:org, :term, :chunk, :tf)"
                ),
                {"org": org_id, "term": term, "chunk": chunk_id, "tf": tf},
            )
        chunk_ids.append(chunk_id)
    await conn.execute(
        text(
            "INSERT INTO bm25_stats (org_id, n_chunks, avg_len)"
            " SELECT :org, count(*), avg(bm25_len) FROM chunks WHERE org_id = :org"
        ),
        {"org": org_id},
    )
    return chunk_ids, doc_ids


async def test_sql_bm25_matches_reference() -> None:
    org_id = f"test-bm25-{uuid.uuid4().hex[:10]}"
    docs = [term_freqs(body) for _, body in CORPUS]
    async with engine.connect() as conn:
        transaction = await conn.begin()
        try:
            chunk_ids, doc_ids = await _insert_corpus(conn, org_id)
            for query in QUERIES:
                expected = reference_scores(docs, query)
                hits = await bm25_search(conn, org_id, query, k=len(CORPUS))
                got = {chunk_id: score for chunk_id, score in hits}
                # Every chunk with a positive reference score is returned, with the same score.
                for chunk_id, score in zip(chunk_ids, expected, strict=True):
                    if score > 0:
                        assert abs(got[chunk_id] - score) < 1e-6, query
                    else:
                        assert chunk_id not in got, query
                # Ranking: scores are non-increasing and agree with the reference order.
                ranked = [chunk_ids.index(chunk_id) for chunk_id, _ in hits]
                reference_order = sorted(
                    (i for i, s in enumerate(expected) if s > 0),
                    key=lambda i: (-expected[i], str(chunk_ids[i])),
                )
                assert ranked == reference_order, query

            # Filters: department and document restrict the candidates.
            hits = await bm25_search(conn, org_id, "leave", departments=["HR"])
            assert {chunk_ids.index(c) for c, _ in hits} == {0, 1, 2}
            hits = await bm25_search(conn, org_id, "leave", document_ids=[doc_ids["Finance"]])
            assert [chunk_ids.index(c) for c, _ in hits] == [5]
            hits = await bm25_search(conn, org_id, "leave", k=2)
            assert len(hits) == 2
            assert await bm25_search(conn, org_id, "the and of") == []  # only stopwords
        finally:
            await transaction.rollback()


def test_ranking_agrees_with_rank_bm25_on_distinctive_terms() -> None:
    """rank_bm25's BM25Okapi uses idf = ln((N - df + 0.5) / (df + 0.5)) (floored), so scores
    differ; for terms in under half of the documents the ranking still agrees."""
    docs = [term_freqs(body) for _, body in CORPUS]
    reference = BM25Okapi([list(doc.elements()) for doc in docs], k1=K1, b=B)
    for query in ("annual leave days", "AI tools work", "visitor badge"):
        ours = reference_scores(docs, query)
        theirs = reference.get_scores(query_terms(query))
        top_ours = max(range(len(docs)), key=lambda i: ours[i])
        top_theirs = max(range(len(docs)), key=lambda i: theirs[i])
        assert top_ours == top_theirs, query
