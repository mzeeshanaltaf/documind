from datetime import date

import pytest

from app.ingestion.header import find_doc_codes, parse_effective_date, parse_header_rows
from app.ingestion.metadata import title_from_lines
from app.ingestion.parser import extract_header
from tests.policies import EXPECTED, POLICIES_DIR


@pytest.mark.parametrize("stem", sorted(EXPECTED))
def test_header_table(stem: str) -> None:
    header = extract_header(POLICIES_DIR / f"{stem}.pdf")
    assert header["doc_code"] == EXPECTED[stem][0]
    assert header["version"] in {"1.0", "1.1"}
    assert isinstance(header["effective_date"], date)
    assert header["effective_date"].year == 2026
    assert header["related_doc_codes"]
    assert header["doc_code"] not in header["related_doc_codes"]
    assert header["owner"] and header["approved_by"] and header["applies_to"]


def test_related_codes_join_wrapped_lines_and_expand_ranges() -> None:
    header = parse_header_rows(
        [
            ["Document\nID", "SIM-GLB-001"],
            [
                "Related\nmanuals",
                "IT Policy Manual (SIM-IT-\n001); Country HR Manuals (SIM-\nHR-101 to SIM-HR-105)",
            ],
        ]
    )
    assert header["related_doc_codes"] == [
        "SIM-HR-101",
        "SIM-HR-102",
        "SIM-HR-103",
        "SIM-HR-104",
        "SIM-HR-105",
        "SIM-IT-001",
    ]


def test_unknown_rows_are_kept_aside() -> None:
    header = parse_header_rows([["Document ID", "X-Y-01"], ["Language", "French prevails"]])
    assert header["other"] == {"Language": "French prevails"}


def test_effective_date_takes_the_first_date() -> None:
    raw = "September 30, 2026 (version 1.1 effective October 5, 2026)"
    assert parse_effective_date(raw) == date(2026, 9, 30)
    assert parse_effective_date("on approval") is None


def test_doc_codes_deduplicated_in_order() -> None:
    assert find_doc_codes("SIM-HR-002, SIM-IT-001 and SIM-HR-002") == ["SIM-HR-002", "SIM-IT-001"]


def test_title_lines() -> None:
    assert title_from_lines(["Simtora Technologies GmbH", "Germany HR Manual (Berlin)"]) == (
        "Simtora Technologies GmbH",
        "Germany HR Manual (Berlin)",
    )
    assert title_from_lines(["Simtora Technologies, Inc. – Company Overview"]) == (
        "Simtora Technologies, Inc.",
        "Company Overview",
    )
    assert title_from_lines(["Just A Title"]) == (None, None)
