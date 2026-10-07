import uuid

from app.agents.citations import cited_numbers, extract_citations, snippet
from app.rag.hybrid import Source


def source(n: int, text: str = "") -> Source:
    return Source(
        n=n,
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        doc_code=f"SIM-HR-10{n}",
        title=f"Manual {n}",
        section_path=["Part 5 – Leave", "5.2 Annual Leave"],
        section_number="5.2",
        section_title="Annual Leave",
        page_start=15,
        page_end=16,
        content_type="prose",
        text=text or f"Source {n} text.",
        jurisdiction="DE",
        department="HR",
        owner="CPO",
    )


def test_markers_in_first_cited_order_without_duplicates() -> None:
    answer = "Thirty days [3]. Five more days [1][3]. Carry-over until March [2, 3]. See [1]."
    assert cited_numbers(answer) == [3, 1, 2]


def test_no_markers() -> None:
    assert cited_numbers("I couldn't find that in the documents.") == []
    assert cited_numbers("Section [a] and [ 1 ] are not markers.") == []


def test_extract_keeps_only_valid_sources_in_order() -> None:
    sources = [source(1), source(2), source(3)]
    answer = "A [2]. B [9]. C [1][2]. D [0]."
    citations = extract_citations(answer, sources)
    assert [c["n"] for c in citations] == [2, 1]
    first = citations[0]
    assert first["doc_code"] == "SIM-HR-102"
    assert first["document_id"] == str(sources[1].document_id)
    assert (first["page_start"], first["page_end"]) == (15, 16)
    assert first["section_number"] == "5.2" and first["section_title"] == "Annual Leave"
    assert first["section_path"] == ["Part 5 – Leave", "5.2 Annual Leave"]
    assert first["highlight_text"] == "Source 2 text."


def test_snippet_is_short_and_flat() -> None:
    long = "word " * 200
    cut = snippet(long)
    assert len(cut) <= 281 and cut.endswith("…")
    assert snippet("line one\n\nline two") == "line one line two"
    assert extract_citations("X [1].", [source(1, "a\nb")])[0]["snippet"] == "a b"
