"""Fusion, jurisdiction boost, de-duplication and selection (pure functions)."""

import uuid

import pytest

from app.rag import hybrid
from app.rag.hybrid import (
    ChunkInfo,
    RankedList,
    SearchFilter,
    apply_boost,
    dedupe_adjacent,
    jurisdiction_factor,
    rrf_fuse,
    select_chunks,
    texts_overlap,
    to_sources,
)

DOC_A, DOC_B = uuid.uuid4(), uuid.uuid4()


def chunk(
    index: int,
    text: str = "",
    *,
    doc: uuid.UUID = DOC_A,
    juris: str | None = "GLOBAL",
    content_type: str = "prose",
    tokens: int = 100,
    path: tuple[str, ...] = ("5.2 Annual Leave",),
) -> ChunkInfo:
    return ChunkInfo(
        id=uuid.uuid4(),
        document_id=doc,
        chunk_index=index,
        text=text or f"chunk {index} of {doc}",
        section_path=list(path),
        section_number="5.2",
        section_title="Annual Leave",
        page_start=10,
        page_end=10,
        content_type=content_type,
        token_count=tokens,
        jurisdiction=juris,
        department="HR",
        doc_code="SIM-HR-102",
        title="Germany HR Manual",
        owner="CPO",
    )


def ranked(method: str, *ids: uuid.UUID) -> RankedList:
    return RankedList(method, "q", SearchFilter(), list(ids))  # type: ignore[arg-type]


@pytest.fixture
def equal_weights(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hybrid, "METHOD_WEIGHTS", {"bm25": 1.0, "vector": 1.0})


def test_rrf_weights_methods() -> None:
    a = uuid.uuid4()
    fused = rrf_fuse([ranked("bm25", a), ranked("vector", a)])
    expected = hybrid.METHOD_WEIGHTS["bm25"] / 61 + hybrid.METHOD_WEIGHTS["vector"] / 61
    assert fused[a].rrf == pytest.approx(expected)


@pytest.mark.usefixtures("equal_weights")
def test_rrf_sums_reciprocal_ranks_across_lists() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    fused = rrf_fuse([ranked("bm25", a, b, c), ranked("vector", b, a), ranked("vector", c)])
    assert fused[a].rrf == pytest.approx(1 / 61 + 1 / 62)
    assert fused[b].rrf == pytest.approx(1 / 62 + 1 / 61)
    assert fused[c].rrf == pytest.approx(1 / 63 + 1 / 61)
    # Best rank per method is kept.
    assert (fused[a].bm25_rank, fused[a].vector_rank) == (1, 2)
    assert (fused[c].bm25_rank, fused[c].vector_rank) == (3, 1)
    # A chunk found by both methods beats one found only near the top of one list.
    d = uuid.uuid4()
    fused = rrf_fuse([ranked("bm25", d, a), ranked("vector", b, a)])
    order = sorted(fused, key=lambda cid: -fused[cid].rrf)
    assert order[0] == a


@pytest.mark.parametrize(
    ("chunk_juris", "target", "doc_type", "factor"),
    [
        ("DE", "DE", "country_supplement", 1.25),
        ("GLOBAL", "DE", "global_supplement", 1.0),
        ("US", "DE", "policy_manual", 0.8),
        ("FR", "DE", "country_supplement", 0.8),
        (None, "DE", None, 1.0),
        ("US", None, "policy_manual", 1.0),
        ("GLOBAL", None, "global_supplement", 1.0),
        ("DE", None, "country_supplement", hybrid.BOOST_SUPPLEMENT_NO_TARGET),
    ],
)
def test_jurisdiction_factor(
    chunk_juris: str | None, target: str | None, doc_type: str | None, factor: float
) -> None:
    assert jurisdiction_factor(chunk_juris, target, doc_type) == factor


def test_boost_reorders_by_jurisdiction() -> None:
    us, de = chunk(0, juris="US"), chunk(1, juris="DE", doc=DOC_B)
    fused = rrf_fuse([ranked("bm25", us.id, de.id)])  # US first on raw RRF
    apply_boost(fused, {us.id: us, de.id: de}, "DE")
    assert fused[de.id].score > fused[us.id].score
    apply_boost(fused, {us.id: us, de.id: de}, None)
    assert fused[us.id].score > fused[de.id].score


def test_texts_overlap_detects_carried_over_tail() -> None:
    first = "Employees receive 30 days of leave.\nLeave accrues monthly from the first day."
    second = "… Leave accrues monthly from the first day.\n\nUnused leave expires on March 31."
    assert texts_overlap(first, second)
    assert not texts_overlap(second, first)
    assert not texts_overlap(first, "… Something else entirely.\n\nMore.")


def test_dedupe_keeps_the_better_of_overlapping_neighbours() -> None:
    first = chunk(4, "Employees receive 30 days.\nLeave accrues monthly from the first day.")
    second = chunk(5, "… Leave accrues monthly from the first day.\n\nUnused leave expires.")
    unrelated = chunk(6, "6.1 Pension\n\nThe company pays 4%.")
    other_doc = chunk(5, "… Leave accrues monthly from the first day.", doc=DOC_B)

    # The later chunk ranks higher: the earlier neighbour is dropped, and vice versa.
    assert dedupe_adjacent([second, first, unrelated]) == [second, unrelated]
    assert dedupe_adjacent([first, second, unrelated]) == [first, unrelated]
    # Same text in another document is not a neighbour.
    assert dedupe_adjacent([first, other_doc]) == [first, other_doc]


def test_dedupe_keeps_table_fragments() -> None:
    header = "Leave entitlements\n\n| Type | Days |\n| --- | --- |"
    a = chunk(7, f"{header}\n| Annual | 30 |", content_type="table")
    b = chunk(8, f"{header}\n| Sick | 42 |", content_type="table")
    assert dedupe_adjacent([a, b]) == [a, b]


def test_select_respects_top_k_and_token_budget() -> None:
    chunks = [chunk(i, tokens=1000) for i in range(10)]
    assert len(select_chunks(chunks, top_k=8)) == 6  # 6,000-token budget
    assert len(select_chunks(chunks, top_k=4)) == 4
    # A chunk too big for what is left is skipped, smaller later ones still fit.
    mixed = [chunk(0, tokens=5500), chunk(1, tokens=900), chunk(2, tokens=400)]
    assert [c.chunk_index for c in select_chunks(mixed, top_k=8)] == [0, 2]


def test_select_pulls_in_sibling_table_fragment() -> None:
    header = "Leave entitlements\n\n| Type | Days |\n| --- | --- |"
    table = chunk(7, f"{header}\n| Annual | 30 |", content_type="table")
    sibling = chunk(8, f"{header}\n| Sick | 42 |", content_type="table")
    other_table = chunk(
        6, "Pension\n\n| Plan | Rate |\n| --- | --- |\n| A | 4% |", content_type="table"
    )
    prose = chunk(20)
    neighbours = {(DOC_A, 6): other_table, (DOC_A, 8): sibling}

    chosen = select_chunks([table, prose], top_k=2, neighbours=neighbours)
    assert chosen == [table, sibling, prose]  # sibling right after its fragment; not counted

    fused = rrf_fuse([ranked("bm25", table.id, prose.id)])
    sources = to_sources(chosen, fused)
    assert [s.n for s in sources] == [1, 2, 3]
    assert sources[0].scores["bm25_rank"] == 1
    assert sources[1].scores["added_as"] == "table_fragment"
    assert sources[2].scores["bm25_rank"] == 2
