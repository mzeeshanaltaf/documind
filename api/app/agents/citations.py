"""Turn the answer's `[n]` markers into citation objects for the UI and the PDF highlighter."""

import re
from collections.abc import Sequence
from typing import Any

from app.rag.hybrid import Source

# [3], and the tolerated variants [1, 3] / [1,3].
MARKER_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
SNIPPET_CHARS = 280


def cited_numbers(text: str) -> list[int]:
    """Source numbers in first-cited order, without duplicates."""
    numbers: list[int] = []
    for match in MARKER_RE.finditer(text):
        for part in match.group(1).split(","):
            n = int(part)
            if n not in numbers:
                numbers.append(n)
    return numbers


def snippet(text: str, limit: int = SNIPPET_CHARS) -> str:
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    cut = flat[:limit].rsplit(" ", 1)[0]
    return f"{cut}…"


def citation(source: Source) -> dict[str, Any]:
    return {
        "n": source.n,
        "document_id": str(source.document_id),
        "chunk_id": str(source.chunk_id),
        "doc_code": source.doc_code,
        "title": source.title,
        "section_number": source.section_number,
        "section_title": source.section_title,
        "section_path": source.section_path,
        "page_start": source.page_start,
        "page_end": source.page_end,
        "snippet": snippet(source.text),
        "highlight_text": source.text,
    }


def extract_citations(text: str, sources: Sequence[Source]) -> list[dict[str, Any]]:
    """Only the cited sources, in first-cited order; numbers with no source are dropped."""
    by_number = {source.n: source for source in sources}
    return [citation(by_number[n]) for n in cited_numbers(text) if n in by_number]
