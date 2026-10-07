"""Metadata merge: header table (from the real PDFs) + recorded LLM classifications."""

import json
from pathlib import Path

import pytest

from app.ingestion.metadata import merge_metadata, normalize_jurisdiction
from app.ingestion.parser import ParsedDocument, extract_header
from tests.policies import EXPECTED, POLICIES_DIR

# Recorded `classify` outputs (gpt-6-luna, flex) for the seed PDFs; refresh when the prompt changes.
FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "metadata_llm.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("stem", sorted(EXPECTED))
def test_seed_metadata(stem: str) -> None:
    recorded = FIXTURE[stem]
    doc = ParsedDocument(
        pages=1,
        header=extract_header(POLICIES_DIR / f"{stem}.pdf"),
        title_lines=recorded["title_lines"],
        blocks=[],
    )
    meta = merge_metadata(doc, recorded["classification"], "A summary.", f"{stem}.pdf")
    assert (meta.doc_code, meta.department, meta.jurisdiction, meta.doc_type) == EXPECTED[stem]
    assert meta.title and meta.legal_entity and meta.effective_date and meta.related_doc_codes


def _doc(header: dict, title_lines: list[str]) -> ParsedDocument:
    return ParsedDocument(pages=1, header=header, title_lines=title_lines, blocks=[])


def test_header_and_title_lines_win_over_llm() -> None:
    doc = _doc(
        {"doc_code": "SIM-HR-102", "version": "1.0"},
        ["Simtora Technologies GmbH", "Germany HR Manual (Berlin)"],
    )
    llm = {
        "department": "HR",
        "jurisdiction": "DE",
        "doc_type": "country_supplement",
        "title": "Some Other Title",
        "legal_entity": "Other Entity",
    }
    meta = merge_metadata(doc, llm, " Summary. ", "x.pdf")
    assert meta.title == "Germany HR Manual (Berlin)"
    assert meta.legal_entity == "Simtora Technologies GmbH"
    assert meta.doc_code == "SIM-HR-102"
    assert meta.summary == "Summary."


def test_generic_pdf_falls_back_to_llm_then_file_name() -> None:
    llm = {
        "department": "Sales",  # not allowed → Other
        "jurisdiction": "UK",  # → GB
        "doc_type": "memo",  # not allowed → other
        "title": "Travel Guide",
        "legal_entity": None,
    }
    meta = merge_metadata(_doc({}, []), llm, None, "travel-guide.pdf")
    assert (meta.title, meta.department, meta.jurisdiction, meta.doc_type) == (
        "Travel Guide",
        "Other",
        "GB",
        "other",
    )
    llm["title"] = None
    assert merge_metadata(_doc({}, []), llm, None, "travel-guide.pdf").title == "travel guide"


def test_normalize_jurisdiction() -> None:
    assert normalize_jurisdiction("uk") == "GB"
    assert normalize_jurisdiction("Global") == "GLOBAL"
    assert normalize_jurisdiction("de") == "DE"
    assert normalize_jurisdiction("Germany") is None
    assert normalize_jurisdiction("") is None
