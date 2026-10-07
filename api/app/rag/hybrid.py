"""Hybrid retrieval: BM25 + vector lists per (query × filter), fused with Reciprocal Rank Fusion.

1. For every query (standalone + sub-queries) and filter (one per specialist department, or the
   user's documents), BM25 top 30 and vector top 30 run in parallel, each on its own session.
   A department-filtered list with < 3 hits is re-run unfiltered.
2. RRF: score(chunk) = Σ weight(method) / (60 + rank) over every list it appears in.
3. Jurisdiction boost (when the router found one): same ×1.25, GLOBAL ×1.0, other country ×0.8;
   with none, country supplements get `BOOST_SUPPLEMENT_NO_TARGET`.
4. Adjacent chunks whose text overlaps (the chunker's carried-over tail) keep the better one.
5. The top `top_k` within ~6,000 tokens become numbered sources; a selected table fragment
   pulls in its neighbouring fragment.

`mode` lets the eval run the same pipeline on one method only ("bm25" or "vector").
"""

import asyncio
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.models.document import Chunk, Document
from app.rag.bm25 import bm25_search
from app.rag.vector import vector_search

Mode = Literal["hybrid", "bm25", "vector"]
Method = Literal["bm25", "vector"]

LIST_K = 30
RRF_K = 60
MIN_FILTERED_HITS = 3
TOKEN_BUDGET = 6000
DEFAULT_TOP_K = 8
GLOBAL = "GLOBAL"
BOOST_SAME = 1.25
BOOST_OTHER_COUNTRY = 0.8
# No country asked about: a country supplement is less likely to be the answer than the base or
# global documents. Tuned on eval/golden.jsonl (2026-10-07, see Status.md): BM25 at full weight
# let generic terms ("paid time off", "performance") outrank the right section; 0.6 / 0.9 gave
# hybrid MRR 0.928 vs 0.878 (plain RRF) and 0.917 (vector only), hit@5 and hit@8 1.0.
BOOST_SUPPLEMENT_NO_TARGET = 0.9
METHOD_WEIGHTS: dict[str, float] = {"bm25": 0.6, "vector": 1.0}
# Concurrent searches; the engine pool is 5 + 5 and the request itself holds connections too.
SEARCH_CONCURRENCY = 6


@dataclass(frozen=True)
class SearchFilter:
    """One specialist's slice of the corpus (None = no restriction)."""

    departments: tuple[str, ...] | None = None
    document_ids: tuple[uuid.UUID, ...] | None = None

    @property
    def label(self) -> str:
        if self.document_ids:
            return "docs"
        return ",".join(self.departments) if self.departments else "all"


@dataclass
class RankedList:
    method: Method
    query: str
    filter: SearchFilter
    hits: list[uuid.UUID]
    fallback: bool = False  # the unfiltered re-run of a sparse department list


@dataclass
class Fused:
    chunk_id: uuid.UUID
    rrf: float = 0.0
    bm25_rank: int | None = None  # best (lowest) rank across BM25 lists
    vector_rank: int | None = None
    score: float = 0.0  # rrf × jurisdiction boost


@dataclass
class ChunkInfo:
    id: uuid.UUID
    document_id: uuid.UUID
    chunk_index: int
    text: str
    section_path: list[str]
    section_number: str | None
    section_title: str | None
    page_start: int | None
    page_end: int | None
    content_type: str | None
    token_count: int
    jurisdiction: str | None
    department: str | None
    doc_code: str | None
    title: str
    owner: str | None
    doc_type: str | None = None


@dataclass
class Source:
    n: int
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    doc_code: str | None
    title: str
    section_path: list[str]
    section_number: str | None
    section_title: str | None
    page_start: int | None
    page_end: int | None
    content_type: str | None
    text: str
    jurisdiction: str | None
    department: str | None
    owner: str | None
    scores: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["chunk_id"], data["document_id"] = str(self.chunk_id), str(self.document_id)
        return data


@dataclass
class RetrievalResult:
    sources: list[Source]
    lists: list[RankedList]
    candidates: int
    timings_ms: dict[str, int]

    def summary(self) -> dict[str, Any]:
        """What gets stored on the assistant message (`messages.retrieval`)."""
        return {
            "lists": [
                {
                    "method": item.method,
                    "query": item.query,
                    "filter": item.filter.label,
                    "hits": len(item.hits),
                    "fallback": item.fallback,
                }
                for item in self.lists
            ],
            "candidates": self.candidates,
            "sources": [
                {"n": s.n, "chunk_id": str(s.chunk_id), "doc_code": s.doc_code, **s.scores}
                for s in self.sources
            ],
            "timings_ms": self.timings_ms,
        }


# --- pure steps ------------------------------------------------------------------------------


def rrf_fuse(lists: Sequence[RankedList], k: int = RRF_K) -> dict[uuid.UUID, Fused]:
    fused: dict[uuid.UUID, Fused] = {}
    for ranked in lists:
        weight = METHOD_WEIGHTS.get(ranked.method, 1.0)
        for rank, chunk_id in enumerate(ranked.hits, start=1):
            item = fused.setdefault(chunk_id, Fused(chunk_id))
            item.rrf += weight / (k + rank)
            attr = "bm25_rank" if ranked.method == "bm25" else "vector_rank"
            best = getattr(item, attr)
            if best is None or rank < best:
                setattr(item, attr, rank)
    for item in fused.values():
        item.score = item.rrf
    return fused


def jurisdiction_factor(
    chunk_jurisdiction: str | None, target: str | None, doc_type: str | None = None
) -> float:
    """×1.25 for the asked-about country, ×1.0 for GLOBAL, ×0.8 for another country-specific
    document. With no target, base and global documents keep ×1.0 and country supplements get
    `BOOST_SUPPLEMENT_NO_TARGET`."""
    if not target:
        return BOOST_SUPPLEMENT_NO_TARGET if doc_type == "country_supplement" else 1.0
    if not chunk_jurisdiction or chunk_jurisdiction == GLOBAL:
        return 1.0
    return BOOST_SAME if chunk_jurisdiction == target else BOOST_OTHER_COUNTRY


def apply_boost(
    fused: dict[uuid.UUID, Fused], info: dict[uuid.UUID, ChunkInfo], target: str | None
) -> None:
    for chunk_id, item in fused.items():
        chunk = info.get(chunk_id)
        item.score = item.rrf * (
            jurisdiction_factor(chunk.jurisdiction, target, chunk.doc_type) if chunk else 1.0
        )


def _normalize(text: str) -> str:
    return " ".join(text.split())


def texts_overlap(earlier: str, later: str) -> bool:
    """The chunker starts a continuation chunk with "… <tail of the previous chunk>"."""
    if not later.startswith("…"):
        return False
    tail = _normalize(later[1:].split("\n\n", 1)[0])
    return bool(tail) and tail[:200] in _normalize(earlier)


def dedupe_adjacent(ranked: Sequence[ChunkInfo]) -> list[ChunkInfo]:
    """`ranked` is best first; drop a chunk whose overlapping neighbour is already kept."""
    kept: list[ChunkInfo] = []
    by_position: dict[tuple[uuid.UUID, int], ChunkInfo] = {}
    for chunk in ranked:
        duplicate = False
        for offset in (-1, 1):
            neighbour = by_position.get((chunk.document_id, chunk.chunk_index + offset))
            if neighbour is None:
                continue
            earlier, later = (neighbour, chunk) if offset == -1 else (chunk, neighbour)
            if texts_overlap(earlier.text, later.text):
                duplicate = True
                break
        if not duplicate:
            kept.append(chunk)
            by_position[(chunk.document_id, chunk.chunk_index)] = chunk
    return kept


def is_table_fragment_pair(a: ChunkInfo, b: ChunkInfo) -> bool:
    """Two neighbouring pieces of one table split by rows (same section, same header lines)."""
    if a.content_type != "table" or b.content_type != "table" or a.document_id != b.document_id:
        return False
    if abs(a.chunk_index - b.chunk_index) != 1 or a.section_path != b.section_path:
        return False
    return a.text.split("\n")[:3] == b.text.split("\n")[:3]


def select_chunks(
    ranked: Sequence[ChunkInfo],
    top_k: int,
    token_budget: int = TOKEN_BUDGET,
    neighbours: dict[tuple[uuid.UUID, int], ChunkInfo] | None = None,
) -> list[ChunkInfo]:
    """The best `top_k` chunks that fit the budget; a table fragment brings its sibling
    fragment(s) right after it when they fit."""
    chosen: list[ChunkInfo] = []
    chosen_ids: set[uuid.UUID] = set()
    used = 0
    primary = 0
    for chunk in ranked:
        if primary >= top_k:
            break
        if chunk.id in chosen_ids or used + chunk.token_count > token_budget:
            continue
        chosen.append(chunk)
        chosen_ids.add(chunk.id)
        used += chunk.token_count
        primary += 1
        if chunk.content_type != "table" or not neighbours:
            continue
        for offset in (-1, 1):
            sibling = neighbours.get((chunk.document_id, chunk.chunk_index + offset))
            if (
                sibling
                and sibling.id not in chosen_ids
                and is_table_fragment_pair(chunk, sibling)
                and used + sibling.token_count <= token_budget
            ):
                chosen.append(sibling)
                chosen_ids.add(sibling.id)
                used += sibling.token_count
    return chosen


def to_sources(chosen: Sequence[ChunkInfo], fused: dict[uuid.UUID, Fused]) -> list[Source]:
    sources = []
    for n, chunk in enumerate(chosen, start=1):
        item = fused.get(chunk.id)
        scores = {
            "bm25_rank": item.bm25_rank if item else None,
            "vector_rank": item.vector_rank if item else None,
            "rrf": round(item.rrf, 6) if item else None,
            "score": round(item.score, 6) if item else None,
            "added_as": None if item else "table_fragment",
        }
        sources.append(
            Source(
                n=n,
                chunk_id=chunk.id,
                document_id=chunk.document_id,
                doc_code=chunk.doc_code,
                title=chunk.title,
                section_path=chunk.section_path,
                section_number=chunk.section_number,
                section_title=chunk.section_title,
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                content_type=chunk.content_type,
                text=chunk.text,
                jurisdiction=chunk.jurisdiction,
                department=chunk.department,
                owner=chunk.owner,
                scores=scores,
            )
        )
    return sources


# --- database steps --------------------------------------------------------------------------

_CHUNK_COLUMNS = (
    Chunk.id,
    Chunk.document_id,
    Chunk.chunk_index,
    Chunk.text,
    Chunk.section_path,
    Chunk.section_number,
    Chunk.section_title,
    Chunk.page_start,
    Chunk.page_end,
    Chunk.content_type,
    Chunk.token_count,
    Chunk.jurisdiction,
    Chunk.department,
    Chunk.doc_type,
    Document.doc_code,
    Document.title,
    Document.owner,
)


def _chunk_info(row: Any) -> ChunkInfo:
    return ChunkInfo(
        id=row.id,
        document_id=row.document_id,
        chunk_index=row.chunk_index,
        text=row.text,
        section_path=list(row.section_path or []),
        section_number=row.section_number,
        section_title=row.section_title,
        page_start=row.page_start,
        page_end=row.page_end,
        content_type=row.content_type,
        token_count=row.token_count or 0,
        jurisdiction=row.jurisdiction,
        department=row.department,
        doc_code=row.doc_code,
        title=row.title,
        owner=row.owner,
        doc_type=row.doc_type,
    )


async def load_chunks(
    session: AsyncSession, org_id: str, chunk_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, ChunkInfo]:
    if not chunk_ids:
        return {}
    rows = await session.execute(
        select(*_CHUNK_COLUMNS)
        .join(Document, Document.id == Chunk.document_id)
        .where(Chunk.org_id == org_id, Chunk.id.in_(list(chunk_ids)))
    )
    return {row.id: _chunk_info(row) for row in rows}


async def load_neighbours(
    session: AsyncSession, org_id: str, chunks: Sequence[ChunkInfo]
) -> dict[tuple[uuid.UUID, int], ChunkInfo]:
    """The ±1 neighbours of the given (table) chunks, keyed by (document_id, chunk_index)."""
    wanted = {(c.document_id, c.chunk_index + d) for c in chunks for d in (-1, 1)}
    if not wanted:
        return {}
    doc_ids = {doc_id for doc_id, _ in wanted}
    indexes = {index for _, index in wanted}
    rows = await session.execute(
        select(*_CHUNK_COLUMNS)
        .join(Document, Document.id == Chunk.document_id)
        .where(
            Chunk.org_id == org_id,
            Chunk.document_id.in_(doc_ids),
            Chunk.chunk_index.in_(indexes),
        )
    )
    found = {(row.document_id, row.chunk_index): _chunk_info(row) for row in rows}
    return {key: value for key, value in found.items() if key in wanted}


async def _run_search(semaphore: asyncio.Semaphore, search: Callable[[AsyncSession], Any]) -> Any:
    # AsyncSession isn't concurrency-safe: every parallel search gets its own session.
    async with semaphore, SessionLocal() as session:
        return await search(session)


async def run_lists(
    org_id: str,
    queries: Sequence[str],
    vectors: Sequence[Sequence[float]] | None,
    filters: Sequence[SearchFilter],
    mode: Mode = "hybrid",
    k: int = LIST_K,
) -> list[RankedList]:
    """All ranked lists for queries × filters × methods, plus unfiltered fallbacks."""
    methods: list[Method] = ["bm25", "vector"] if mode == "hybrid" else [mode]
    if "vector" in methods and (vectors is None or len(vectors) != len(queries)):
        raise ValueError("vector search needs one embedding per query")
    semaphore = asyncio.Semaphore(SEARCH_CONCURRENCY)

    def plan(method: Method, qi: int, flt: SearchFilter, fallback: bool = False) -> Any:
        query = queries[qi]
        departments = None if fallback else flt.departments
        doc_ids = flt.document_ids

        async def search(session: AsyncSession) -> RankedList:
            if method == "bm25":
                hits = await bm25_search(
                    session, org_id, query, k=k, document_ids=doc_ids, departments=departments
                )
            else:
                assert vectors is not None
                hits = await vector_search(
                    session,
                    org_id,
                    vectors[qi],
                    k=k,
                    document_ids=doc_ids,
                    departments=departments,
                )
            return RankedList(method, query, flt, [chunk_id for chunk_id, _ in hits], fallback)

        return _run_search(semaphore, search)

    jobs = [
        (method, qi, flt) for qi in range(len(queries)) for flt in filters for method in methods
    ]
    lists: list[RankedList] = list(await asyncio.gather(*(plan(*job) for job in jobs)))

    sparse = [
        (method, qi, flt)
        for (method, qi, flt), ranked in zip(jobs, lists, strict=True)
        if flt.departments and len(ranked.hits) < MIN_FILTERED_HITS
    ]
    if sparse:
        lists += await asyncio.gather(*(plan(m, qi, f, fallback=True) for m, qi, f in sparse))
    return lists


async def retrieve(
    org_id: str,
    queries: Sequence[str],
    vectors: Sequence[Sequence[float]] | None,
    filters: Sequence[SearchFilter],
    *,
    jurisdiction: str | None = None,
    top_k: int = DEFAULT_TOP_K,
    mode: Mode = "hybrid",
    token_budget: int = TOKEN_BUDGET,
) -> RetrievalResult:
    started = time.perf_counter()
    lists = await run_lists(org_id, queries, vectors, filters or [SearchFilter()], mode)
    searched = time.perf_counter()

    fused = rrf_fuse(lists)
    async with SessionLocal() as session:
        info = await load_chunks(session, org_id, list(fused))
        apply_boost(fused, info, jurisdiction)
        ranked_ids = sorted(fused, key=lambda cid: (-fused[cid].score, str(cid)))
        ranked = dedupe_adjacent([info[cid] for cid in ranked_ids if cid in info])
        # Only the table chunks that could be selected need their neighbours.
        tables = [c for c in ranked[: top_k * 2] if c.content_type == "table"]
        neighbours = await load_neighbours(session, org_id, tables) if tables else {}
    chosen = select_chunks(ranked, top_k, token_budget, neighbours)
    finished = time.perf_counter()

    return RetrievalResult(
        sources=to_sources(chosen, fused),
        lists=lists,
        candidates=len(fused),
        timings_ms={
            "search": round((searched - started) * 1000),
            "fuse_select": round((finished - searched) * 1000),
        },
    )
