import json

import pytest

from app.core.config import get_settings
from app.schemas.datasets import CaseFields
from app.services.importer import (
    GOLDEN_OPTIONS,
    ImportOptions,
    fill_departments,
    infer_type,
    map_row,
    parse_jsonl,
)


def test_infer_type_jurisdiction_wins_over_multi_hop() -> None:
    assert infer_type({"expected_jurisdiction": "DE", "expected_doc_codes": ["A", "B"]}) == (
        "jurisdiction"
    )
    assert infer_type({"expected_doc_codes": ["A", "B"]}) == "multi_hop"
    assert infer_type({"expected_doc_codes": ["A"]}) == "single_hop"
    assert infer_type({}) == "single_hop"


def test_map_row_applies_mapping_defaults_and_keys() -> None:
    options = ImportOptions(
        dataset_slug="demo",
        mapping={"expected_jurisdiction": "jurisdiction", "question": "q"},
        defaults={"tags": ["golden"], "source": "imported", "expected_behavior": "answer"},
        key_prefix="golden",
    )
    row = map_row(
        {"q": "Leave in Berlin?", "jurisdiction": "DE", "tags": "hr|leave", "extra": 1},
        options,
        index=7,
    )
    assert row["case_key"] == "golden-007"
    assert row["question"] == "Leave in Berlin?"
    assert row["expected_jurisdiction"] == "DE"
    assert row["type"] == "jurisdiction"
    assert row["tags"] == ["hr", "leave", "golden"]  # own tags first, defaults added
    assert row["source"] == "imported"
    assert "extra" not in row


def test_map_row_keeps_explicit_type_and_key() -> None:
    row = map_row(
        {"case_key": "k-1", "type": "out_of_scope", "question": "Weather?"},
        ImportOptions(dataset_slug="demo"),
        index=1,
    )
    assert (row["case_key"], row["type"]) == ("k-1", "out_of_scope")


def test_unknown_mapping_target_is_rejected() -> None:
    from app.core.errors import ApiError

    with pytest.raises(ApiError) as caught:
        map_row({"q": "x"}, ImportOptions(dataset_slug="d", mapping={"nope": "q"}), index=1)
    assert caught.value.code == "invalid_mapping"


def test_parse_reports_bad_rows_by_line() -> None:
    content = "\n".join(
        [
            json.dumps({"question": "ok", "case_key": "a"}),
            "{not json",
            json.dumps({"question": "ok", "case_key": "a"}),  # duplicate key
            json.dumps({"question": "", "case_key": "b"}),  # blank question
            json.dumps({"question": "x", "type": "nonsense"}),
            "[1, 2]",
        ]
    )
    parsed = parse_jsonl(content, ImportOptions(dataset_slug="demo"))
    assert [c.case_key for c in parsed.cases] == ["a"]
    assert [e.line for e in parsed.errors] == [2, 3, 4, 5, 6]
    assert "Duplicate case_key" in parsed.errors[1].message


def test_golden_file_parses_into_30_typed_cases() -> None:
    content = get_settings().golden_file.read_text(encoding="utf-8")
    parsed = parse_jsonl(content, GOLDEN_OPTIONS)
    assert parsed.errors == []
    assert len(parsed.cases) == 30
    assert parsed.cases[0].case_key == "golden-001"
    assert parsed.cases[-1].case_key == "golden-030"
    types = [c.type for c in parsed.cases]
    assert types.count("jurisdiction") == 10
    assert types.count("multi_hop") == 3
    assert all(c.tags == ["golden"] and c.source == "imported" for c in parsed.cases)
    assert all(c.expected_behavior == "answer" for c in parsed.cases)
    germany = parsed.cases[2]
    assert (germany.expected_jurisdiction, germany.expected_sections) == (
        "DE",
        ["SIM-HR-102 §5.2"],
    )


def test_fill_departments_from_doc_codes() -> None:
    cases = [
        CaseFields(case_key="a", type="multi_hop", question="q", expected_doc_codes=["H", "I"]),
        CaseFields(case_key="b", type="single_hop", question="q", expected_doc_codes=["X"]),
        CaseFields(
            case_key="c",
            type="single_hop",
            question="q",
            expected_doc_codes=["H"],
            expected_departments=["Kept"],
        ),
    ]
    warnings = fill_departments(cases, {"H": "HR", "I": "IT"})
    assert cases[0].expected_departments == ["HR", "IT"]
    assert cases[1].expected_departments == []
    assert cases[2].expected_departments == ["Kept"]
    assert warnings == ["b: unknown doc codes X"]
