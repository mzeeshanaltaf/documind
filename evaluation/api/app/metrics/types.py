"""The plain data a metric reads: the dataset case, DocuMind's output for one mode, and the
retrieved contexts. Metrics are pure functions of these, so unit tests build them by hand."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

Scale = Literal["binary", "unit", "ms", "count", "usd"]
Direction = Literal["higher", "lower"]
Status = Literal["ok", "na", "error", "refusal"]
RunModeName = Literal["full", "retrieval_only"]

# Cases whose expected behaviour is to answer from the documents: retrieval and citation
# metrics only apply to them.
ANSWERING = frozenset({"answer", "answer_ignoring_injection"})


@dataclass(frozen=True)
class CaseSpec:
    """The parts of a dataset case the deterministic metrics read."""

    case_key: str
    type: str = "single_hop"
    question: str = ""
    expected_behavior: str = "answer"
    expected_doc_codes: tuple[str, ...] = ()
    expected_sections: tuple[str, ...] = ()
    expected_pages: Any = None
    expected_departments: tuple[str, ...] = ()
    expected_jurisdiction: str | None = None
    forbidden_doc_codes: tuple[str, ...] = ()
    injection_canary: str | None = None

    @property
    def answering(self) -> bool:
        return self.expected_behavior in ANSWERING

    @classmethod
    def from_model(cls, case: Any) -> "CaseSpec":
        """From a `Case` row (or anything with the same attributes)."""
        return cls(
            case_key=case.case_key,
            type=case.type,
            question=case.question,
            expected_behavior=case.expected_behavior,
            expected_doc_codes=tuple(case.expected_doc_codes or ()),
            expected_sections=tuple(case.expected_sections or ()),
            expected_pages=case.expected_pages,
            expected_departments=tuple(case.expected_departments or ()),
            expected_jurisdiction=case.expected_jurisdiction,
            forbidden_doc_codes=tuple(case.forbidden_doc_codes or ()),
            injection_canary=case.injection_canary,
        )


@dataclass(frozen=True)
class Context:
    """One retrieved source, in DocuMind's rank order (`n` is its citation number)."""

    rank: int
    n: int
    document_id: str | None = None
    doc_code: str | None = None
    section_number: str | None = None
    section_title: str | None = None
    page_start: int | None = None
    page_end: int | None = None
    text: str | None = None
    chunk_id: str | None = None

    @property
    def label(self) -> str:
        return f"{self.doc_code} §{self.section_number or '-'}"


@dataclass(frozen=True)
class CaseOutput:
    """What DocuMind produced for one case in one mode (`chat` = a full run's scored turn), plus
    the run-level facts some metrics need."""

    mode: str = "chat"
    run_mode: RunModeName = "full"
    answer: str | None = None
    routing: Mapping[str, Any] | None = None
    citations: Sequence[Mapping[str, Any]] = ()
    needs_clarification: bool = False
    latency_ms: int | None = None
    ttft_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    top_k: int = 8
    # The org's document ids (None = unknown, so the foreign-document check is skipped).
    org_document_ids: frozenset[str] | None = None
    canary_phrases: tuple[str, ...] = ()


@dataclass(frozen=True)
class MetricResult:
    value: float | None
    status: Status = "ok"
    details: dict[str, Any] = field(default_factory=dict)


def ok(value: float | bool, **details: Any) -> MetricResult:
    return MetricResult(float(value), "ok", details)


def na(reason: str, **details: Any) -> MetricResult:
    return MetricResult(None, "na", {"reason": reason, **details})


Compute = Callable[[CaseSpec, CaseOutput, Sequence[Context]], MetricResult]


@dataclass(frozen=True)
class MetricSpec:
    """A metric: how it reads (`scale`, `direction`), when it applies, and whether it gates the
    case. `compute(case, output, contexts)` is pure."""

    key: str
    group: str  # retrieval | routing | citations | operational | safety (| generation, E4)
    scale: Scale
    direction: Direction
    compute: Compute
    applies_to: Callable[[CaseSpec], bool] = lambda _case: True
    run_modes: frozenset[str] = frozenset({"full", "retrieval_only"})
    default_threshold: float | None = None
    requires_judge: bool = False
    gating: bool = False
    description: str = ""

    def passes(self, value: float | None, threshold: float | None) -> bool | None:
        if value is None or threshold is None:
            return None
        return value >= threshold if self.direction == "higher" else value <= threshold
