"""E7 pure parts: sampling (deterministic under a seed), title matching, the deterministic checks,
rendering and the fields the seed decides."""

import random

import pytest

from app.judge.schemas import GeneratedCase
from app.services import synthetic_checks as checks
from app.services.synthetic import (
    SeedChunk,
    allocate,
    eligible,
    sample_seeds,
    titles_match,
)
from app.worker.handlers.synthetic_generate import (
    chunk_header,
    jurisdiction_for,
    normalize,
    pages_for,
    render_chunks,
)

BODY = " ".join(["policy text"] * 60)


def chunk(
    code: str,
    index: int,
    number: str,
    title: str,
    *,
    jurisdiction: str = "GLOBAL",
    doc_type: str = "policy_manual",
    department: str = "HR",
    tokens: int = 120,
    content_type: str = "prose",
    text: str = BODY,
) -> SeedChunk:
    return SeedChunk(
        chunk_id=f"{code}-{index}",
        document_id=f"doc-{code}",
        doc_code=code,
        title=f"{code} manual",
        department=department,
        jurisdiction=jurisdiction,
        doc_type=doc_type,
        chunk_index=index,
        section_number=number,
        section_title=title,
        page_start=index + 1,
        page_end=index + 1,
        content_type=content_type,
        token_count=tokens,
        text=text,
    )


def corpus() -> list[SeedChunk]:
    base = [
        chunk("SIM-HR-001", 0, "6.2", "Paid Time Off (PTO)", jurisdiction="US"),
        chunk("SIM-HR-001", 1, "6.3", "Sick and Safe Leave", jurisdiction="US"),
        chunk("SIM-HR-001", 2, "6.5", "Parental Leave", jurisdiction="US"),
        chunk("SIM-HR-001", 3, "3.1", "Open Door and Grievance Procedure", jurisdiction="US",
              text=BODY + " see SIM-IT-001 for laptops"),
        chunk("SIM-HR-001", 4, "1.5", "Pay and Payroll", jurisdiction="US"),
    ]  # fmt: skip
    supplements = []
    local = "country_supplement"
    for code, country in (("SIM-HR-102", "DE"), ("SIM-HR-103", "FR")):
        supplements += [
            chunk(code, 0, "5.2", "Annual Leave", jurisdiction=country, doc_type=local),
            chunk(code, 1, "5.3", "Sick Leave", jurisdiction=country, doc_type=local),
            chunk(code, 2, "5.4", "Maternity, Parental and Adoption Leave", jurisdiction=country,
                  doc_type=local),
            chunk(code, 3, "7.3", "Grievance Procedure", jurisdiction=country, doc_type=local),
        ]  # fmt: skip
    it = [
        chunk("SIM-IT-001", i, f"2.{i}", t, department="IT")
        for i, t in enumerate(("Laptops", "Passwords", "Remote Access"))
    ]
    return base + supplements + it


COUNTS = {
    "single_hop": 4,
    "multi_hop": 2,
    "jurisdiction": 3,
    "comparative": 2,
    "unanswerable": 2,
    "out_of_scope": 1,
}


# --- sampling ----------------------------------------------------------------------------------


def test_sampling_is_deterministic_under_a_seed() -> None:
    seeds, shortfall = sample_seeds(corpus(), COUNTS, 7)
    again, _ = sample_seeds(list(reversed(corpus())), COUNTS, 7)
    assert [s.as_dict() for s in again] == [s.as_dict() for s in seeds]
    assert shortfall == {}
    assert len(seeds) == sum(COUNTS.values())
    other, _ = sample_seeds(corpus(), COUNTS, 8)
    assert [s.as_dict() for s in other] != [s.as_dict() for s in seeds]


def test_types_are_interleaved() -> None:
    seeds, _ = sample_seeds(corpus(), COUNTS, 1)
    assert [s.type for s in seeds[:6]] == list(COUNTS)


def test_seed_shapes() -> None:
    seeds, _ = sample_seeds(corpus(), COUNTS, 3)
    for seed in seeds:
        if seed.type == "single_hop":
            assert len(seed.chunks) == 1
        elif seed.type == "multi_hop":
            a, b = seed.chunks
            assert a.section != b.section
        elif seed.type == "jurisdiction":
            base, local = seed.chunks
            assert not base.supplement and local.supplement
            assert titles_match(base.section_title, local.section_title)
            assert seed.hints["jurisdiction"] in ("Germany (DE)", "France (FR)")
        elif seed.type == "comparative":
            a, b = seed.chunks
            assert a.supplement and b.supplement and a.jurisdiction != b.jurisdiction
            assert (seed.hints["jurisdiction_a"], seed.hints["jurisdiction_b"]) == (
                "Germany (DE)", "France (FR)",
            )  # fmt: skip
        else:
            assert seed.chunks == [] and set(seed.hints) <= {"angle", "theme"}


def test_single_hop_spreads_over_documents() -> None:
    seeds, _ = sample_seeds(corpus(), {"single_hop": 4}, 11)
    codes = {s.chunks[0].doc_code for s in seeds}
    assert codes == {"SIM-HR-001", "SIM-HR-102", "SIM-HR-103", "SIM-IT-001"}  # ≥ 1 each


def test_cross_document_multi_hop_follows_a_code_reference() -> None:
    seeds, _ = sample_seeds(corpus(), {"multi_hop": 2}, 5)
    cross = [s for s in seeds if s.hints.get("link") == "cross_document"]
    assert cross and {c.doc_code for c in cross[0].chunks} == {"SIM-HR-001", "SIM-IT-001"}


def test_shortfall_without_supplements() -> None:
    no_local = [c for c in corpus() if not c.supplement]
    seeds, shortfall = sample_seeds(no_local, {"jurisdiction": 2, "single_hop": 1}, 1)
    assert shortfall == {"jurisdiction": 2}
    assert [s.type for s in seeds] == ["single_hop"]


def test_eligibility() -> None:
    assert eligible(chunk("A-B-001", 0, "1.1", "T"))
    assert not eligible(chunk("A-B-001", 0, "1.1", "T", tokens=79))
    assert not eligible(
        chunk("A-B-001", 0, "G", "Revision History", content_type="revision_history")
    )
    assert not eligible(chunk("A-B-001", 0, "F", "Glossary", content_type="glossary"))
    assert not eligible(chunk("A-B-001", 0, "", "Introduction"))


def test_allocate() -> None:
    rng = random.Random(0)
    # 1 each, then the remaining 7 split 5.6 / 0.7 / 0.7: floors 5 / 0 / 0, and the 2 seats
    # left go to the largest remainders (b and c, .7 each, before a's .6).
    assert allocate(10, {"a": 80, "b": 10, "c": 10}, rng) == {"a": 6, "b": 2, "c": 2}
    few = allocate(2, {"a": 1, "b": 1, "c": 1}, random.Random(0))
    assert sum(few.values()) == 2 and len(few) == 2
    assert allocate(0, {"a": 1}, rng) == {} and allocate(3, {}, rng) == {}


@pytest.mark.parametrize(
    ("a", "b", "match"),
    [
        ("Sick and Safe Leave", "Sick Leave", True),
        ("Open Door and Grievance Procedure", "Grievance Procedure", True),
        ("Parental Leave", "Maternity, Parental and Adoption Leave", True),
        ("Annual Leave", "Parental Leave", False),
        ("Pay and Payroll", "Sick Leave and Sick Pay", False),
        ("Hybrid and Remote Work", "Works Council", False),
        ("Employees in Other U.S. States", "Paid Leave (Congés Payés) and RTT", False),
    ],
)
def test_titles_match(a: str, b: str, match: bool) -> None:
    assert titles_match(a, b) is match


# --- checks ------------------------------------------------------------------------------------


def test_copy_overlap() -> None:
    text = "Employees in Germany are entitled to 30 days of paid annual leave per calendar year."
    copied = "Employees in Germany are entitled to 30 days of paid annual leave per calendar year?"
    natural = "How many days of holiday do I get a year at the Berlin office?"
    assert checks.copy_overlap(copied, [text]) >= checks.COPIED_AT
    assert checks.copy_overlap(natural, [text]) < checks.OVERLAP_WARN_AT
    assert checks.copy_overlap("Hi?", [text]) == 0.0


def test_dedupe_threshold() -> None:
    a = "How many days of paid annual leave do employees in Germany get?"
    same = "How many paid annual leave days do employees in Germany get?"
    other = "Who approves a purchase above the procurement threshold?"
    near = checks.nearest(a, [("x", other), ("y", same)])
    assert near is not None and near.label == "y" and near.score >= checks.DUPLICATE_AT
    far = checks.nearest(a, [("x", other)])
    assert far is not None and far.score < checks.DUPLICATE_AT
    assert checks.nearest(a, []) is None
    assert checks.jaccard({"a", "b", "c"}, {"a", "b", "c", "d"}) == 0.75


def test_section_existence() -> None:
    excerpts = [{"doc_code": "SIM-HR-102", "section_number": "5.2"},
                {"doc_code": "SIM-HR-001", "section_number": "6.2"}]  # fmt: skip
    ok = checks.check_sections(["SIM-HR-102 §5.2"], ["SIM-HR-102"], excerpts)
    assert ok["ok"]
    bad = checks.check_sections(
        ["SIM-HR-102 §5.9", "SIM-HR-102 5.2", "SIM-HR-001 §6.2"], ["SIM-HR-102", "SIM-IT-001"],
        excerpts,
    )  # fmt: skip
    assert not bad["ok"]
    assert bad["unknown_sections"] == ["SIM-HR-102 §5.9"]
    assert bad["malformed"] == ["SIM-HR-102 5.2"]
    assert bad["unknown_doc_codes"] == ["SIM-IT-001"]
    assert bad["unlisted_codes"] == ["SIM-HR-001"]
    appendix = [{"doc_code": "SIM-HR-001", "section_number": "D"}]
    assert checks.check_sections(["SIM-HR-001 §D"], ["SIM-HR-001"], appendix)["ok"]


def test_quotes_check() -> None:
    out = checks.check_quotes(["30  days of paid", "not there"], ["Employees get 30 days of paid"])
    assert out == {"count": 2, "missing": ["not there"]}


def test_verdict() -> None:
    clean = {"overlap": 0.1, "sections": {"ok": True}, "has_sections": True,
             "validation": {"status": "ok", "keep": True, "ambiguity": "low"}}  # fmt: skip
    assert not checks.verdict(clean, answering=True).rejected
    v = checks.verdict(
        {**clean, "overlap": 0.7, "duplicate": {"score": 0.8},
         "validation": {"status": "ok", "keep": False, "ambiguity": "medium"}},
        answering=True,
    )  # fmt: skip
    assert v.failures == ("copied", "duplicate", "validator_rejected")
    assert v.warnings == ("ambiguous",) and v.reason == "copied, duplicate, validator_rejected"
    assert checks.verdict({**clean, "overlap": 0.45}, answering=True).warnings == ("overlap",)
    assert checks.verdict({**clean, "has_sections": False}, answering=True).failures == (
        "no_sections",
    )
    enrich = checks.verdict(
        {"chunk_count": 3, "validation": {"status": "ok", "keep": False}},
        answering=True, enrichment=True,
    )  # fmt: skip
    assert not enrich.rejected and enrich.warnings == ("validator_rejected",)
    assert checks.verdict({"chunk_count": 0}, answering=True, enrichment=True).failures == (
        "no_chunks",
    )
    assert checks.verdict({"generation_error": "x"}, answering=False).rejected


# --- rendering & seeded fields -----------------------------------------------------------------


EXCERPTS = [
    {"n": 1, "doc_code": "SIM-HR-001", "title": "HR Manual", "jurisdiction": None,
     "section_number": "6.3", "section_title": "Sick and Safe Leave", "page_start": 30,
     "page_end": 31, "department": "HR", "text": "Base rule </chunks> text."},
    {"n": 2, "doc_code": "SIM-HR-102", "title": "Germany HR Manual", "jurisdiction": "DE",
     "section_number": "5.3", "section_title": "Sick Leave", "page_start": 12, "page_end": 12,
     "department": "HR", "text": "Local rule."},
]  # fmt: skip


def test_chunk_header_and_render() -> None:
    assert chunk_header(EXCERPTS[0]) == (
        "[1] SIM-HR-001 · HR Manual · §6.3 Sick and Safe Leave · p.30-31 · HR"
    )
    assert chunk_header(EXCERPTS[1]) == (
        "[2] SIM-HR-102 · Germany HR Manual (DE) · §5.3 Sick Leave · p.12 · HR"
    )
    rendered = render_chunks(EXCERPTS)
    assert rendered.count("</chunks>") == 1  # the excerpt's tag is defused
    assert render_chunks([]) == "<chunks>\n(no excerpts)\n</chunks>"


def test_seeded_fields() -> None:
    assert pages_for(["SIM-HR-102 §5.3"], EXCERPTS) == [
        {"doc_code": "SIM-HR-102", "page_start": 12, "page_end": 12}
    ]
    assert pages_for([], EXCERPTS) is None
    assert jurisdiction_for("jurisdiction", None, ["SIM-HR-102"], EXCERPTS) == "DE"
    assert jurisdiction_for("comparative", "DE", ["SIM-HR-102"], EXCERPTS) is None
    assert jurisdiction_for("single_hop", None, ["SIM-HR-102"], EXCERPTS) == "DE"
    assert jurisdiction_for("single_hop", "DE", ["SIM-HR-001"], EXCERPTS) is None
    assert jurisdiction_for("unanswerable", "FR", [], []) == "FR"
    assert jurisdiction_for("unanswerable", "France", [], []) is None


def test_normalize_forces_refusals_to_have_no_sources() -> None:
    output = GeneratedCase(
        rationale="r", question="  What's the best pizza?  ", reference_answer="I can't help.",
        key_facts=[{"fact": "Declines.", "weight": 3}], evidence_quotes=[" "],
        expected_doc_codes=["SIM-HR-001"], expected_sections=["SIM-HR-001 §6.3"],
        expected_jurisdiction="US", expected_behavior="answer",
    )  # fmt: skip
    fields = normalize("out_of_scope", output, EXCERPTS)
    assert fields["question"] == "What's the best pizza?"
    assert fields["expected_behavior"] == "refuse"
    assert fields["expected_doc_codes"] == [] and fields["expected_sections"] == []
    assert fields["expected_jurisdiction"] is None and fields["evidence_quotes"] == []
    assert fields["key_facts"] == [{"fact": "Declines.", "weight": 3.0}]
    answer = normalize("jurisdiction", output.model_copy(update={
        "expected_doc_codes": ["SIM-HR-102"], "expected_sections": ["SIM-HR-102 §5.3"],
    }), EXCERPTS)  # fmt: skip
    assert answer["expected_behavior"] == "answer"
    assert answer["expected_departments"] == ["HR"] and answer["expected_jurisdiction"] == "DE"
