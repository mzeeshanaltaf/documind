"""Deterministic citation metrics on a full run's answer. The claim-based ones (citation
precision/recall) need the judge (E4)."""

import re
from collections.abc import Iterator, Mapping, Sequence
from typing import Any

from app.metrics.retrieval import is_relevant, retrieval_applies
from app.metrics.types import CaseOutput, CaseSpec, Context, MetricResult, MetricSpec, na, ok

# DocuMind's own marker syntax (`api/app/agents/citations.py::MARKER_RE`): `[2]`, and also
# `[1, 3]`. Each number in a marker counts once per occurrence.
MARKER_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
FULL_ONLY = frozenset({"full"})


def markers(answer: str) -> list[int]:
    return [int(n) for match in MARKER_RE.finditer(answer) for n in match.group(1).split(",")]


def citation_validity(
    _case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]
) -> MetricResult:
    """Markers whose number is one of the sources / all markers, on the raw answer text."""
    found = markers(output.answer or "")
    if not found:
        return na("no citation markers")
    numbers = {c.n for c in contexts}
    invalid = sorted({n for n in found if n not in numbers})
    valid = sum(1 for n in found if n in numbers)
    return ok(valid / len(found), markers=len(found), invalid=invalid)


def _cited(output: CaseOutput) -> list[Mapping[str, Any]]:
    return [c for c in output.citations if c]


def cited_section_hit(
    case: CaseSpec, output: CaseOutput, _contexts: Sequence[Context]
) -> MetricResult:
    """Some cited source is relevant (the retrieval label); no citations scores 0."""
    cited = _cited(output)
    hits = [
        f"{c.get('doc_code')} §{c.get('section_number')}"
        for c in cited
        if is_relevant(c.get("doc_code"), c.get("section_number"), case)
    ]
    return ok(bool(hits), cited=len(cited), relevant=hits)


def cited_doc_precision(
    case: CaseSpec, output: CaseOutput, _contexts: Sequence[Context]
) -> MetricResult:
    docs = {c.get("doc_code") for c in _cited(output)}
    if not docs:
        return na("no citations")
    good = docs & set(case.expected_doc_codes)
    return ok(len(good) / len(docs), cited_docs=sorted(map(str, docs)), expected=sorted(good))


def expected_pages(
    value: Any, doc_code: str | None = None
) -> Iterator[tuple[str | None, int, int]]:
    """Normalize `expected_pages` into (doc_code | None, first, last) ranges. Accepted shapes:
    `12`, `"12-14"`, `[12, 13]`, `{"page": 12}`, `{"doc_code": …, "page_start": …, "page_end": …}`
    and `{"SIM-HR-001": [29, 30]}`."""
    match value:
        case None | "":
            return
        case bool():
            return
        case int():
            yield doc_code, value, value
        case str():
            first, _, last = value.partition("-")
            if first.strip().isdigit():
                end = last.strip() if last.strip().isdigit() else first
                yield doc_code, int(first), int(end)
        case list() | tuple():
            for item in value:
                yield from expected_pages(item, doc_code)
        case dict() if {"page", "page_start", "pages"} & value.keys():
            code = value.get("doc_code", doc_code)
            if "pages" in value:
                yield from expected_pages(value["pages"], code)
            else:
                start = value.get("page_start", value.get("page"))
                end = value.get("page_end", start)
                if isinstance(start, int) and isinstance(end, int):
                    yield code, start, end
        case dict():
            for code, pages in value.items():
                yield from expected_pages(pages, str(code))


def page_hit(case: CaseSpec, output: CaseOutput, _contexts: Sequence[Context]) -> MetricResult:
    """A citation's page range overlaps an expected page range (of the same document when the
    expectation names one); no citations scores 0."""
    wanted = list(expected_pages(case.expected_pages))
    if not wanted:
        return na("no usable expected_pages")
    for citation in _cited(output):
        start, end = citation.get("page_start"), citation.get("page_end")
        if start is None:
            continue
        end = end if end is not None else start
        for code, first, last in wanted:
            if (
                (code is None or code == citation.get("doc_code"))
                and start <= last
                and end >= first
            ):
                return ok(True, page=[start, end], doc_code=citation.get("doc_code"))
    return ok(False, cited=len(_cited(output)))


SPECS = [
    MetricSpec(
        "citation_validity", "citations", "unit", "higher", citation_validity,
        run_modes=FULL_ONLY, default_threshold=1.0, gating=True,
        description="Answer [n] markers that match a source / all markers.",
    ),
    MetricSpec(
        "cited_section_hit", "citations", "binary", "higher", cited_section_hit,
        retrieval_applies, run_modes=FULL_ONLY,
        description="Some cited source is an expected document/section.",
    ),
    MetricSpec(
        "cited_doc_precision", "citations", "unit", "higher", cited_doc_precision,
        retrieval_applies, run_modes=FULL_ONLY,
        description="Cited documents that are expected / cited documents.",
    ),
    MetricSpec(
        "page_hit", "citations", "binary", "higher", page_hit,
        lambda case: case.answering and case.expected_pages not in (None, "", [], {}),
        run_modes=FULL_ONLY,
        description="A citation covers an expected page.",
    ),
]  # fmt: skip
