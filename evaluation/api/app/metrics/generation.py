"""Generation metrics powered by the Claude judge: claim-level faithfulness and the claim-based
citation metrics, key-fact recall, context precision/recall and the answer-quality rubric.

The judge calls happen in `services/judging.py`; the math is here, pure, so tests can check it by
hand. Judge metrics only run in full runs.
"""

import statistics
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.metrics.types import CaseOutput, CaseSpec, Context, MetricResult, MetricSpec, na, ok

FULL_ONLY = frozenset({"full"})
CLAIM_METRICS = (
    "faithfulness",
    "hallucination",
    "citation_precision",
    "citation_recall",
    "supported_citation_recall",
)
QUALITY_DIMENSIONS = (
    "correctness",
    "completeness",
    "relevance",
    "jurisdiction_handling",
    "refusal_helpfulness",
)
VERDICT_VALUE = {"pass": 1.0, "borderline": 0.5, "fail": 0.0}
FACT_CREDIT = {"yes": 1.0, "partial": 0.5, "no": 0.0}
HALLUCINATION_NOT_FOUND_SHARE = 0.2
NO_REFERENCE = "no_reference"


def judge_only(_case: CaseSpec, _output: CaseOutput, _contexts: Sequence[Context]) -> MetricResult:
    raise RuntimeError("Judge metrics are computed by the case_judge job, not registry.evaluate")


@dataclass(frozen=True)
class ClaimRow:
    """One extracted claim and its verdict (None when verification failed)."""

    idx: int
    text: str
    sentence_idx: int | None = None
    citation_ns: tuple[int, ...] = ()
    verdict: str | None = None
    supporting_ns: tuple[int, ...] = ()
    evidence_quote: str | None = None
    reasoning: str | None = None

    @property
    def cited(self) -> bool:
        return bool(self.citation_ns)

    @property
    def correctly_cited(self) -> bool:
        return bool(set(self.citation_ns) & set(self.supporting_ns))


def claim_metrics(claims: Sequence[ClaimRow]) -> dict[str, MetricResult]:
    """faithfulness = supported / claims; hallucination = any contradicted claim or more than 20 %
    not_found; citation_precision = cited claims with a cited n among the supporting sources /
    cited claims; citation_recall = cited claims / claims; supported_citation_recall = supported
    claims that are correctly cited / supported claims. No claims → every one is `na`."""
    if not claims:
        return {key: na("no_claims") for key in CLAIM_METRICS}
    n = len(claims)
    supported = [c for c in claims if c.verdict == "supported"]
    contradicted = [c.idx for c in claims if c.verdict == "contradicted"]
    not_found = [c.idx for c in claims if c.verdict == "not_found"]
    cited = [c for c in claims if c.cited]
    counts = {
        "claims": n,
        "supported": len(supported),
        "contradicted": len(contradicted),
        "not_found": len(not_found),
    }
    results = {
        "faithfulness": ok(len(supported) / n, **counts),
        "hallucination": ok(
            bool(contradicted) or len(not_found) / n > HALLUCINATION_NOT_FOUND_SHARE,
            contradicted_idx=contradicted,
            not_found_idx=not_found,
            **counts,
        ),
        "citation_recall": ok(len(cited) / n, cited=len(cited), claims=n),
    }
    if cited:
        good = [c.idx for c in cited if c.correctly_cited]
        results["citation_precision"] = ok(
            len(good) / len(cited),
            cited=len(cited),
            correctly_cited=len(good),
            miscited_idx=[c.idx for c in cited if not c.correctly_cited],
        )
    else:
        results["citation_precision"] = na("no_cited_claims")
    if supported:
        good = [c for c in supported if c.correctly_cited]
        results["supported_citation_recall"] = ok(
            len(good) / len(supported), supported=len(supported), correctly_cited=len(good)
        )
    else:
        results["supported_citation_recall"] = na("no_supported_claims")
    return results


def fact_weights(case: CaseSpec) -> list[float]:
    weights = []
    for fact in case.key_facts:
        try:
            weights.append(max(float(fact.get("weight", 1.0)), 0.0))
        except (TypeError, ValueError):
            weights.append(1.0)
    return weights


def key_fact_recall(weights: Sequence[float], entailed: Mapping[int, str]) -> MetricResult:
    """Σ weight of entailed facts (partial = 0.5) / Σ weight; facts are numbered from 1."""
    total = sum(weights)
    if not weights or total <= 0:
        return na(NO_REFERENCE)
    credit = sum(
        weight * FACT_CREDIT.get(entailed.get(i, "no"), 0.0)
        for i, weight in enumerate(weights, start=1)
    )
    missing = [i for i in range(1, len(weights) + 1) if i not in entailed]
    return ok(
        credit / total,
        facts=len(weights),
        entailed={str(i): v for i, v in sorted(entailed.items())},
        missing_verdicts=missing,
    )


def average_precision(relevance: Sequence[bool]) -> float:
    """AP over a ranked list: the mean of precision@k at each relevant rank (0 with none)."""
    hits, total = 0, 0.0
    for k, relevant in enumerate(relevance, start=1):
        if relevant:
            hits += 1
            total += hits / k
    return total / hits if hits else 0.0


def normalize_score(score: float) -> float:
    """A 1-5 rubric score on 0-1: (s - 1) / 4."""
    return (score - 1) / 4


def median_and_spread(values: Sequence[float]) -> tuple[float, float | None]:
    """The median, and the population std as the spread (None for a single sample)."""
    median = float(statistics.median(values))
    spread = float(statistics.pstdev(values)) if len(values) > 1 else None
    return median, spread


def quality_details(sample: Any) -> dict[str, Any]:
    """The reasoning kept with every answer_quality.* score (from the first sample)."""
    return {
        "verdict": sample.verdict,
        "summary": sample.summary,
        "analysis": sample.analysis.model_dump(),
        "issues": [issue.model_dump() for issue in sample.issues],
    }


def _spec(key: str, scale: str, description: str, **kwargs: Any) -> MetricSpec:
    return MetricSpec(
        key, "generation", scale, kwargs.pop("direction", "higher"), judge_only,
        run_modes=FULL_ONLY, requires_judge=True, description=description, **kwargs,
    )  # fmt: skip


SPECS = [
    _spec("faithfulness", "unit", "Claims supported by the sources / claims (Haiku).",
          default_threshold=0.9, gating=True),
    _spec("hallucination", "binary", "A contradicted claim, or more than 20 % not found.",
          direction="lower", default_threshold=0.0),
    _spec("citation_precision", "unit",
          "Cited claims whose citation supports them / cited claims."),
    _spec("citation_recall", "unit", "Claims carrying a citation / claims."),
    _spec("supported_citation_recall", "unit",
          "Supported claims cited with a supporting source / supported claims."),
    _spec("key_fact_recall", "unit",
          "Weighted key facts the answer conveys (partial = 0.5); needs key facts."),
    _spec("context_recall", "unit",
          "Weighted key facts the retrieved sources contain; needs key facts."),
    _spec("context_precision", "unit", "Average precision of the sources Haiku judges relevant.",
          applies_to=lambda case: case.answering),
    _spec("answer_quality", "unit", "The rubric judge's verdict: pass 1, borderline 0.5, fail 0."),
    _spec("answer_quality.correctness", "unit",
          "Agreement with the reference, (s-1)/4; needs a reference.",
          default_threshold=0.5, gating=True),
    _spec("answer_quality.completeness", "unit", "Covers what the sources offer, (s-1)/4."),
    _spec("answer_quality.relevance", "unit", "Stays on the question, (s-1)/4."),
    _spec("answer_quality.jurisdiction_handling", "unit",
          "Right jurisdiction or clear variations, (s-1)/4; when it matters."),
    _spec("answer_quality.refusal_helpfulness", "unit",
          "A warranted, helpful refusal or clarification, (s-1)/4; when it refuses."),
    _spec("followup_resolution", "unit",
          "The standalone query resolves the follow-up, (s-1)/4 (rubric judge).",
          applies_to=lambda case: bool(case.setup_turns)),
]  # fmt: skip
