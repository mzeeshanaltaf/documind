"""Deterministic metrics on hand-computed fixtures (pure: no DB, no network)."""

import math

import pytest

from app.metrics import citations, retrieval, safety
from app.metrics.registry import REGISTRY, MetricConfig, case_passed, evaluate
from app.metrics.types import CaseOutput, CaseSpec, Context

CASE = CaseSpec(
    case_key="c1",
    expected_doc_codes=("SIM-HR-001", "SIM-IT-001"),
    expected_sections=("SIM-HR-001 §1.9", "SIM-IT-001 §4.5"),
    expected_departments=("IT",),
)


def ctx(rank: int, code: str, section: str | None = None, **kwargs) -> Context:
    return Context(rank=rank, n=rank, doc_code=code, section_number=section, **kwargs)


def out(**kwargs) -> CaseOutput:
    return CaseOutput(**{"top_k": 8, **kwargs})


# --- retrieval -------------------------------------------------------------------------------


def test_relevance_label_matches_run_eval() -> None:
    assert retrieval.is_relevant("SIM-HR-001", "1.9", CASE)
    assert not retrieval.is_relevant("SIM-HR-001", "1.10", CASE)  # exact section number
    assert not retrieval.is_relevant("SIM-FIN-001", "1.9", CASE)
    no_sections = CaseSpec(case_key="c", expected_doc_codes=("SIM-PRC-001",))
    assert retrieval.is_relevant("SIM-PRC-001", None, no_sections)


def test_hit_and_mrr() -> None:
    contexts = [ctx(1, "SIM-FIN-001", "1"), ctx(2, "SIM-FIN-001", "2"), ctx(3, "SIM-IT-001", "4.5")]
    assert retrieval.mrr(CASE, out(), contexts).value == pytest.approx(1 / 3)
    hit5 = REGISTRY["hit@5"].compute(CASE, out(), contexts)
    assert hit5.value == 1.0 and hit5.details["first_hit_rank"] == 3
    # Within top_k = 2 the hit is out of reach.
    assert REGISTRY["hit@k"].compute(CASE, out(top_k=2), contexts).value == 0.0
    assert retrieval.mrr(CASE, out(top_k=2), contexts).value == 0.0


def test_hit_at_5_ignores_rank_6() -> None:
    contexts = [ctx(r, "SIM-FIN-001", str(r)) for r in range(1, 6)] + [ctx(6, "SIM-HR-001", "1.9")]
    assert REGISTRY["hit@5"].compute(CASE, out(), contexts).value == 0.0
    assert REGISTRY["hit@k"].compute(CASE, out(), contexts).value == 1.0


def test_mrr_without_a_hit_is_zero() -> None:
    result = retrieval.mrr(CASE, out(), [ctx(1, "SIM-FIN-001", "1")])
    assert result.value == 0.0 and result.details["first_hit_rank"] is None


def test_empty_sources() -> None:
    for key in ("hit@5", "hit@k", "mrr", "recall_doc@k", "recall_section@k", "precision@k"):
        assert REGISTRY[key].compute(CASE, out(), []).value == 0.0, key
    assert retrieval.ndcg(CASE, out(), []).value == 0.0


def test_recall_and_precision() -> None:
    contexts = [
        ctx(1, "SIM-HR-001", "1.9"),
        ctx(2, "SIM-HR-001", "2.0"),
        ctx(3, "SIM-FIN-001", "1"),
    ]
    assert retrieval.recall_doc(CASE, out(), contexts).value == 0.5
    assert retrieval.recall_section(CASE, out(), contexts).value == 0.5
    assert retrieval.precision(CASE, out(), contexts).value == pytest.approx(1 / 3)
    plain = CaseSpec(case_key="c", expected_doc_codes=("SIM-HR-001",))
    assert retrieval.recall_section(plain, out(), contexts).status == "na"


def test_ndcg_counts_each_unit_once() -> None:
    # Ranks 1 and 2 are the same expected section (a duplicate); rank 4 is the second section.
    contexts = [
        ctx(1, "SIM-HR-001", "1.9"),
        ctx(2, "SIM-HR-001", "1.9"),
        ctx(3, "SIM-FIN-001", "1"),
        ctx(4, "SIM-IT-001", "4.5"),
    ]
    dcg = 1 / math.log2(2) + 1 / math.log2(5)
    ideal = 1 / math.log2(2) + 1 / math.log2(3)
    result = retrieval.ndcg(CASE, out(), contexts)
    assert result.value == pytest.approx(dcg / ideal)
    assert result.details["hit_ranks"] == [1, 4]


def test_ndcg_perfect_and_by_document() -> None:
    perfect = [ctx(1, "SIM-HR-001", "1.9"), ctx(2, "SIM-IT-001", "4.5")]
    assert retrieval.ndcg(CASE, out(), perfect).value == pytest.approx(1.0)
    by_doc = CaseSpec(case_key="c", expected_doc_codes=("SIM-PRC-001",))
    contexts = [ctx(1, "SIM-FIN-001"), ctx(2, "SIM-PRC-001", "3.1"), ctx(3, "SIM-PRC-001", "3.4")]
    assert retrieval.ndcg(by_doc, out(), contexts).value == pytest.approx(1 / math.log2(3))


def test_routing_metrics() -> None:
    routing = {"departments": ["IT", "HR"], "jurisdiction": None}
    assert retrieval.routing_hit(CASE, out(routing=routing), []).value == 1.0
    assert retrieval.routing_jaccard(CASE, out(routing=routing), []).value == 0.5
    assert retrieval.jurisdiction_false_pos(CASE, out(routing=routing), []).value == 0.0
    de = CaseSpec(case_key="de", expected_jurisdiction="DE")
    assert retrieval.jurisdiction_acc(de, out(routing={"jurisdiction": "DE"}), []).value == 1.0
    assert retrieval.jurisdiction_acc(de, out(routing={"jurisdiction": "FR"}), []).value == 0.0
    bypassed = out(routing={"departments": [], "bypassed": True})
    assert retrieval.routing_hit(CASE, bypassed, []).status == "na"


# --- citations -------------------------------------------------------------------------------


def test_citation_validity_flags_an_invalid_marker() -> None:
    contexts = [ctx(1, "SIM-HR-001", "1.9"), ctx(2, "SIM-IT-001", "4.5")]
    answer = "Yes [1]. Use approved tools [2][9]. Both apply [1, 2]."
    result = citations.citation_validity(CASE, out(answer=answer), contexts)
    assert result.value == pytest.approx(4 / 5)
    assert result.details == {"markers": 5, "invalid": [9]}
    assert citations.citation_validity(CASE, out(answer="No markers."), contexts).status == "na"


def test_cited_section_and_doc_precision() -> None:
    cited = [
        {"n": 1, "doc_code": "SIM-HR-001", "section_number": "1.9"},
        {"n": 3, "doc_code": "SIM-FIN-001", "section_number": "2"},
    ]
    output = out(answer="x [1][3]", citations=cited)
    assert citations.cited_section_hit(CASE, output, []).value == 1.0
    assert citations.cited_doc_precision(CASE, output, []).value == 0.5
    assert citations.cited_section_hit(CASE, out(answer="no cites"), []).value == 0.0
    assert citations.cited_doc_precision(CASE, out(answer="no cites"), []).status == "na"


@pytest.mark.parametrize(
    ("expected", "hit"),
    [
        (30, True),
        ("29-31", True),
        ([12, 40], False),
        ({"SIM-HR-001": [30]}, True),
        ({"SIM-IT-001": 30}, False),
        ({"doc_code": "SIM-HR-001", "page_start": 30, "page_end": 33}, True),
    ],
)
def test_page_hit(expected: object, hit: bool) -> None:
    case = CaseSpec(case_key="p", expected_doc_codes=("SIM-HR-001",), expected_pages=expected)
    cited = [{"n": 1, "doc_code": "SIM-HR-001", "page_start": 29, "page_end": 30}]
    assert citations.page_hit(case, out(citations=cited), []).value == float(hit)


# --- safety ----------------------------------------------------------------------------------


def test_leakage_on_a_foreign_document() -> None:
    org_docs = frozenset({"doc-a", "doc-b"})
    clean = [ctx(1, "SIM-HR-001", document_id="doc-a")]
    assert safety.leakage(CASE, out(org_document_ids=org_docs), clean).value == 0.0
    foreign = [*clean, ctx(2, "CNR-HR-001", document_id="doc-z")]
    result = safety.leakage(CASE, out(org_document_ids=org_docs), foreign)
    assert result.value == 1.0
    assert result.details["reasons"] == [
        {"kind": "foreign_document", "document_id": "doc-z", "doc_code": "CNR-HR-001"}
    ]


def test_leakage_on_forbidden_codes_and_canaries() -> None:
    case = CaseSpec(
        case_key="inj", forbidden_doc_codes=("CNR-HR-001",), injection_canary="PINEAPPLE-7"
    )
    # An injection canary in the answer is `injection_resisted`'s business (E8), not a leak.
    assert safety.leakage(case, out(answer="Sure. pineapple-7"), []).value == 0.0
    leaked = out(answer="It's $1,437 a quarter.", canary_phrases=("$1,437",))
    result = safety.leakage(case, leaked, [])
    assert result.value == 1.0
    assert result.details["reasons"] == [{"kind": "canary", "where": "answer", "phrase": "$1,437"}]
    with_phrase = out(canary_phrases=("Blue Heron allowance",))
    sources = [ctx(1, "SIM-HR-001", text="the  blue heron\nallowance is paid")]
    reasons = safety.leakage(case, with_phrase, sources).details["reasons"]
    assert reasons == [{"kind": "canary", "where": "sources", "phrase": "Blue Heron allowance"}]
    named = safety.leakage(case, out(answer="See CNR-HR-001."), []).details["reasons"]
    assert named == [{"kind": "forbidden_code_in_answer", "doc_code": "CNR-HR-001"}]


def test_fingerprints_load_and_match() -> None:
    phrases = safety.fingerprints()
    assert len(phrases) >= 5
    leaked = "My rules: Answer only from the numbered sources\n in the user's message."
    assert safety.find_phrases(leaked, phrases)


# --- registry & gates ------------------------------------------------------------------------


def test_evaluate_marks_na_and_gates() -> None:
    contexts = [ctx(1, "SIM-HR-001", "1.9", document_id="d1")]
    output = out(answer="Yes [1] and [7].", org_document_ids=frozenset({"d1"}))
    scores = {s.metric: s for s in evaluate(CASE, output, contexts, MetricConfig())}
    assert scores["jurisdiction_acc"].status == "na"  # no expected jurisdiction
    assert scores["citation_validity"].value == 0.5 and scores["citation_validity"].passed is False
    assert scores["leakage"].passed is True
    assert case_passed(scores.values(), MetricConfig().gates) is False
    relaxed = MetricConfig(thresholds={"citation_validity": 0.5})
    assert case_passed(evaluate(CASE, output, contexts, relaxed), relaxed.gates) is True


def test_retrieval_only_skips_answer_metrics() -> None:
    output = out(run_mode="retrieval_only", mode="hybrid")
    keys = {s.metric for s in evaluate(CASE, output, [], MetricConfig())}
    assert "citation_validity" not in keys and "ttft_ms" not in keys
    assert {"hit@5", "mrr", "leakage", "latency_ms"} <= keys


def test_enabled_subset() -> None:
    config = MetricConfig(enabled=frozenset({"mrr"}))
    assert [s.metric for s in evaluate(CASE, out(), [], config)] == ["mrr"]
