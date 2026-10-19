"""Retrieval and routing metrics over DocuMind's ranked sources.

The relevance label is ported from `api/eval/run_eval.py::is_hit`: a source is relevant when its
`doc_code` is expected and, if the case lists `expected_sections`, `"CODE §section"` is one of
them (exact section number). `k` is the run's effective `top_k`; ranks are 1-based and only the
first k sources count, as in `run_eval.first_hit`.
"""

import math
from collections.abc import Sequence

from app.metrics.types import (
    CaseOutput,
    CaseSpec,
    Compute,
    Context,
    MetricResult,
    MetricSpec,
    na,
    ok,
)


def is_relevant(doc_code: str | None, section_number: str | None, case: CaseSpec) -> bool:
    """`run_eval.is_hit`, on plain fields so citations can use it too."""
    if doc_code not in case.expected_doc_codes:
        return False
    if not case.expected_sections:
        return True
    return f"{doc_code} §{section_number}" in case.expected_sections


def first_hit(contexts: Sequence[Context], case: CaseSpec, k: int) -> int | None:
    for rank, context in enumerate(contexts[:k], start=1):
        if is_relevant(context.doc_code, context.section_number, case):
            return rank
    return None


def retrieval_applies(case: CaseSpec) -> bool:
    return case.answering and bool(case.expected_doc_codes)


def _top(contexts: Sequence[Context], k: int) -> list[Context]:
    return sorted(contexts, key=lambda c: c.rank)[:k]


def _hit_at(k_of: int | None) -> Compute:
    def compute(case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]) -> MetricResult:
        k = k_of or output.top_k
        rank = first_hit(_top(contexts, k), case, k)
        return ok(rank is not None, k=k, first_hit_rank=rank)

    return compute


def mrr(case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]) -> MetricResult:
    """1/rank of the first relevant source within the top k; a miss scores 0 (as run_eval)."""
    k = output.top_k
    rank = first_hit(_top(contexts, k), case, k)
    return ok(1 / rank if rank else 0.0, k=k, first_hit_rank=rank)


def recall_doc(case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]) -> MetricResult:
    k = output.top_k
    expected = set(case.expected_doc_codes)
    found = expected & {c.doc_code for c in _top(contexts, k)}
    return ok(
        len(found) / len(expected), k=k, found=sorted(found), missing=sorted(expected - found)
    )


def recall_section(case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]) -> MetricResult:
    if not case.expected_sections:
        return na("no expected_sections")
    k = output.top_k
    expected = set(case.expected_sections)
    found = expected & {f"{c.doc_code} §{c.section_number}" for c in _top(contexts, k)}
    return ok(
        len(found) / len(expected), k=k, found=sorted(found), missing=sorted(expected - found)
    )


def precision(case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]) -> MetricResult:
    """Relevant sources / sources retrieved within the top k (0 when nothing was retrieved)."""
    k = output.top_k
    top = _top(contexts, k)
    if not top:
        return ok(0.0, k=k, retrieved=0)
    relevant = sum(is_relevant(c.doc_code, c.section_number, case) for c in top)
    return ok(relevant / len(top), k=k, retrieved=len(top), relevant=relevant)


def expected_units(case: CaseSpec) -> list[str]:
    """What nDCG counts: the expected sections when listed, else the expected documents."""
    return list(dict.fromkeys(case.expected_sections or case.expected_doc_codes))


def _unit_of(context: Context, case: CaseSpec, units: set[str]) -> str | None:
    if case.expected_sections:
        unit = f"{context.doc_code} §{context.section_number}"
    else:
        unit = context.doc_code or ""
    return unit if unit in units else None


def ndcg(case: CaseSpec, output: CaseOutput, contexts: Sequence[Context]) -> MetricResult:
    """Binary-gain nDCG@k where each expected unit counts once, at the first rank that hits it
    (a second chunk of the same section adds nothing)."""
    k = output.top_k
    units = expected_units(case)
    remaining = set(units)
    dcg, gains = 0.0, []
    for rank, context in enumerate(_top(contexts, k), start=1):
        unit = _unit_of(context, case, remaining)
        if unit is not None:
            remaining.discard(unit)
            dcg += 1 / math.log2(rank + 1)
            gains.append(rank)
    ideal = sum(1 / math.log2(rank + 1) for rank in range(1, min(len(units), k) + 1))
    return ok(dcg / ideal if ideal else 0.0, k=k, hit_ranks=gains, units=len(units))


# --- routing ---------------------------------------------------------------------------------


def _routing(output: CaseOutput) -> tuple[dict | None, str | None]:
    routing = dict(output.routing or {})
    if not routing:
        return None, "no routing"
    if routing.get("bypassed"):
        return None, "routing bypassed (scoped to documents)"
    return routing, None


def routing_hit(case: CaseSpec, output: CaseOutput, _: Sequence[Context]) -> MetricResult:
    """`run_eval.Outcome.routed_ok`: an expected department was routed."""
    routing, reason = _routing(output)
    if routing is None:
        return na(reason or "")
    routed = set(routing.get("departments") or [])
    expected = set(case.expected_departments)
    return ok(bool(expected & routed), routed=sorted(routed), expected=sorted(expected))


def routing_jaccard(case: CaseSpec, output: CaseOutput, _: Sequence[Context]) -> MetricResult:
    routing, reason = _routing(output)
    if routing is None:
        return na(reason or "")
    routed = set(routing.get("departments") or [])
    expected = set(case.expected_departments)
    return ok(len(expected & routed) / len(expected | routed), routed=sorted(routed))


def jurisdiction_acc(case: CaseSpec, output: CaseOutput, _: Sequence[Context]) -> MetricResult:
    routing, reason = _routing(output)
    if routing is None:
        return na(reason or "")
    routed = routing.get("jurisdiction")
    return ok(routed == case.expected_jurisdiction, routed=routed)


def jurisdiction_false_pos(
    case: CaseSpec, output: CaseOutput, _: Sequence[Context]
) -> MetricResult:
    """1 when the router picked a country for a question that names none."""
    routing, reason = _routing(output)
    if routing is None:
        return na(reason or "")
    routed = routing.get("jurisdiction")
    return ok(routed is not None, routed=routed)


SPECS = [
    MetricSpec(
        "hit@5", "retrieval", "binary", "higher", _hit_at(5), retrieval_applies,
        description="A relevant source within the first 5.",
    ),
    MetricSpec(
        "hit@k", "retrieval", "binary", "higher", _hit_at(None), retrieval_applies,
        description="A relevant source within the first top_k.",
    ),
    MetricSpec(
        "mrr", "retrieval", "unit", "higher", mrr, retrieval_applies,
        description="1/rank of the first relevant source within top_k (miss = 0).",
    ),
    MetricSpec(
        "recall_doc@k", "retrieval", "unit", "higher", recall_doc, retrieval_applies,
        description="Share of the expected documents within top_k.",
    ),
    MetricSpec(
        "recall_section@k", "retrieval", "unit", "higher", recall_section, retrieval_applies,
        description="Share of the expected sections within top_k.",
    ),
    MetricSpec(
        "precision@k", "retrieval", "unit", "higher", precision, retrieval_applies,
        description="Relevant sources / sources within top_k.",
    ),
    MetricSpec(
        "ndcg@k", "retrieval", "unit", "higher", ndcg, retrieval_applies,
        description="nDCG@top_k; each expected unit counts once.",
    ),
    MetricSpec(
        "routing_hit", "routing", "binary", "higher", routing_hit,
        lambda case: bool(case.expected_departments),
        description="An expected department was routed.",
    ),
    MetricSpec(
        "routing_jaccard", "routing", "unit", "higher", routing_jaccard,
        lambda case: bool(case.expected_departments),
        description="Jaccard of routed vs expected departments.",
    ),
    MetricSpec(
        "jurisdiction_acc", "routing", "binary", "higher", jurisdiction_acc,
        lambda case: case.expected_jurisdiction is not None,
        description="The router found the expected country.",
    ),
    MetricSpec(
        "jurisdiction_false_pos", "routing", "binary", "lower", jurisdiction_false_pos,
        lambda case: case.expected_jurisdiction is None and case.answering,
        description="The router picked a country the question doesn't name.",
    ),
]  # fmt: skip
