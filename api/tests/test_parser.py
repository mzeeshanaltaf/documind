from app.ingestion.parser import split_heading
from tests.policies import parsed


def test_hr_manual_basics() -> None:
    doc = parsed("HR-Policy-Manual")
    assert doc.pages == 78
    assert doc.title_lines == ["Simtora Technologies, Inc.", "Human Resources Policy Manual"]
    assert doc.header["doc_code"] == "SIM-HR-001"


def test_section_heading_on_page_30() -> None:
    doc = parsed("HR-Policy-Manual")
    matches = [b for b in doc.blocks if b.kind == "heading" and b.text.startswith("3.1 Open Door")]
    assert len(matches) == 1
    heading = matches[0]
    assert heading.text == "3.1 Open Door and Grievance Procedure"
    assert heading.level == 2
    assert heading.page == 30


def test_part_and_subheading_levels() -> None:
    doc = parsed("HR-Policy-Manual")
    levels = {b.text: b.level for b in doc.blocks if b.kind == "heading" and b.page in (30, 31)}
    assert levels["Part 3 – Dealing with Employee Concerns"] == 1
    assert levels["Steps"] == 3
    assert levels["Mediation"] == 3


def test_grievance_table_is_a_table_block_on_page_31() -> None:
    doc = parsed("HR-Policy-Manual")
    tables = [b for b in doc.blocks if b.kind == "table" and b.page == 31]
    assert len(tables) == 1
    header_row = tables[0].text.splitlines()[0]
    assert header_row == "| Stage | What happens | Typical timescale |"
    assert "Response within 15 business days of receipt" in tables[0].text
    # Table words don't leak into the prose.
    prose = [b.text for b in doc.blocks if b.kind != "table" and b.page == 31]
    assert not any("What happens" in text for text in prose)


def test_footers_are_dropped() -> None:
    doc = parsed("HR-Policy-Manual")
    assert not any("Page 30 of 78" in b.text for b in doc.blocks)
    assert not any("of 78" in b.text and b.text.startswith("Page ") for b in doc.blocks)


def test_table_of_contents_is_skipped() -> None:
    doc = parsed("HR-Policy-Manual")
    assert not any(b.page in (2, 3) for b in doc.blocks)
    assert not any(b.kind == "heading" and b.text == "Contents" for b in doc.blocks)


def test_lists_and_paragraph_joining() -> None:
    doc = parsed("HR-Policy-Manual")
    page30 = [b for b in doc.blocks if b.page == 30]
    assert page30[0].kind == "list"
    assert page30[0].text.startswith("4. The review dates")
    assert "\n5. The possible outcomes" in page30[0].text
    # Wrapped lines join into one paragraph; spaces before punctuation are repaired.
    assert any(
        b.text.startswith("Outcomes are: (a) successful completion: the PIP ends") for b in page30
    )


def test_outline() -> None:
    doc = parsed("HR-Policy-Manual")
    entry = next(item for item in doc.outline if item["number"] == "3.1")
    assert entry == {
        "number": "3.1",
        "title": "Open Door and Grievance Procedure",
        "page": 30,
        "level": 2,
    }
    assert {
        "number": "Part 3",
        "title": "Dealing with Employee Concerns",
        "page": 30,
        "level": 1,
    } in doc.outline
    # Title lines aren't outline entries.
    assert all(item["title"] != "Human Resources Policy Manual" for item in doc.outline)


def test_wrapped_heading_across_page_break() -> None:
    doc = parsed("HR-Germany-Manual")
    titles = [item["title"] for item in doc.outline if item["level"] == 1]
    assert "Working Time, Remote Work and On-Call" in titles
    assert "On-Call" not in titles


def test_wrapped_title_on_page_one() -> None:
    assert parsed("Company-Overview").title_lines == [
        "Simtora Technologies, Inc. – Company Overview"
    ]


def test_header_table_on_page_two() -> None:
    assert parsed("International-Operations-Supplement").header["doc_code"] == "SIM-GLB-001"


def test_split_heading() -> None:
    assert split_heading("3.1 Open Door") == ("3.1", "Open Door")
    assert split_heading("1. Simtora at a Glance") == ("1", "Simtora at a Glance")
    assert split_heading("Part 3 – Dealing with Employee Concerns") == (
        "Part 3",
        "Dealing with Employee Concerns",
    )
    assert split_heading("Appendix G – Revision History") == ("G", "Revision History")
    assert split_heading("Mediation") == (None, "Mediation")
