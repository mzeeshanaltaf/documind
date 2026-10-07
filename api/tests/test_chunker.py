import pytest

from app.ingestion.chunker import (
    MAX_TOKENS,
    ChunkDraft,
    EmbedContext,
    chunk_document,
    count_tokens,
    find_cross_refs,
)
from app.ingestion.parser import Block, ParsedDocument
from tests.policies import parsed

HR_CTX = EmbedContext("SIM-HR-001", "Human Resources Policy Manual", "1.1", "US", "HR")


@pytest.fixture(scope="module")
def hr_chunks() -> list[ChunkDraft]:
    return chunk_document(parsed("HR-Policy-Manual"), HR_CTX)


def test_chunks_respect_section_boundaries(hr_chunks: list[ChunkDraft]) -> None:
    for chunk in hr_chunks:
        numbers = {
            line.split(" ", 1)[0]
            for line in chunk.text.splitlines()
            if line[:1].isdigit() and "." in line.split(" ", 1)[0] and line == line.strip()
        }
        # A chunk only contains the heading of its own section (no "3.2 …" inside a 3.1 chunk).
        headings = {n for n in numbers if n.count(".") == 1 and n[-1].isdigit()}
        assert headings <= {chunk.section_number}, (chunk.section_number, headings)


def test_section_number_matches_every_heading_in_the_chunk(hr_chunks: list[ChunkDraft]) -> None:
    doc = parsed("HR-Policy-Manual")
    numbered = {b.text for b in doc.blocks if b.kind == "heading" and b.text[:1].isdigit()}
    for chunk in hr_chunks:
        inside = [h for h in numbered if f"{h}\n" in chunk.text + "\n"]
        for heading in inside:
            assert heading.startswith(f"{chunk.section_number} "), (heading, chunk.section_number)


def test_token_limit(hr_chunks: list[ChunkDraft]) -> None:
    assert all(c.token_count <= MAX_TOKENS for c in hr_chunks)
    assert all(c.token_count == count_tokens(c.text) for c in hr_chunks)


def test_open_door_chunk(hr_chunks: list[ChunkDraft]) -> None:
    chunk = next(c for c in hr_chunks if "Open Door" in c.text)
    assert chunk.section_number == "3.1"
    assert chunk.section_title == "Open Door and Grievance Procedure"
    assert chunk.page_start == 30
    assert chunk.section_path == [
        "Part 3 – Dealing with Employee Concerns",
        "3.1 Open Door and Grievance Procedure",
    ]
    assert chunk.content_type == "prose"


def test_grievance_table_chunk(hr_chunks: list[ChunkDraft]) -> None:
    chunk = next(c for c in hr_chunks if "| Stage | What happens |" in c.text)
    assert chunk.content_type == "table"
    assert chunk.section_number == "3.1"
    assert chunk.page_start == 31
    assert chunk.text.startswith("Steps\n\n| Stage")


def test_embed_text_header(hr_chunks: list[ChunkDraft]) -> None:
    for chunk in hr_chunks:
        assert chunk.embed_text.startswith("[SIM-HR-001")
        assert chunk.embed_text.endswith(chunk.text)
    chunk = next(c for c in hr_chunks if "Open Door" in c.text)
    assert chunk.embed_text.startswith(
        "[SIM-HR-001 · Human Resources Policy Manual v1.1 · US · HR | "
        "Part 3 – Dealing with Employee Concerns › 3.1 Open Door and Grievance Procedure]\n"
    )


def test_indexes_and_pages_are_consistent(hr_chunks: list[ChunkDraft]) -> None:
    assert [c.chunk_index for c in hr_chunks] == list(range(len(hr_chunks)))
    assert all(1 <= c.page_start <= c.page_end <= 78 for c in hr_chunks)


def test_revision_history_and_appendix_types(hr_chunks: list[ChunkDraft]) -> None:
    types = {c.content_type for c in hr_chunks}
    assert {"prose", "table", "revision_history"} <= types


def _long_section(paragraphs: int) -> ParsedDocument:
    sentence = "Employees must record all overtime hours in the timekeeping system each week. "
    blocks = [Block("heading", 2, "4.2 Overtime", 10)]
    blocks += [Block("paragraph", None, sentence * 12, 10 + i // 3) for i in range(paragraphs)]
    blocks.append(Block("heading", 2, "4.3 Breaks", 14))
    blocks.append(Block("paragraph", None, "Rest breaks are paid.", 14))
    return ParsedDocument(pages=20, header={}, title_lines=[], blocks=blocks)


def test_long_section_splits_with_overlap() -> None:
    chunks = chunk_document(_long_section(12), HR_CTX)
    overtime = [c for c in chunks if c.section_number == "4.2"]
    assert len(overtime) > 1
    assert all(c.token_count <= MAX_TOKENS for c in chunks)
    assert all(c.text.startswith("… ") for c in overtime[1:])  # carried overlap
    breaks = [c for c in chunks if c.section_number == "4.3"]
    assert len(breaks) == 1 and "Overtime" not in breaks[0].text


def test_cross_refs() -> None:
    text = "See SIM-HR-002 (1.5), section 3.2, §4.1 and SIM-HR-001."
    assert find_cross_refs(text, own_code="SIM-HR-001") == ["SIM-HR-002", "1.5", "3.2", "4.1"]
