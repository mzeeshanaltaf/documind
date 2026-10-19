"""Per-case latency, TTFT, tokens and DocuMind cost. The run-level `error_rate` is computed from
case statuses in `services/aggregates.py` (an errored case has no scores)."""

from collections.abc import Callable, Sequence

from app.metrics.types import CaseOutput, CaseSpec, Context, MetricResult, MetricSpec, na, ok


def _field(name: str) -> Callable[[CaseSpec, CaseOutput, Sequence[Context]], MetricResult]:
    def compute(_case: CaseSpec, output: CaseOutput, _contexts: Sequence[Context]) -> MetricResult:
        value = getattr(output, name)
        return na(f"no {name}") if value is None else ok(value)

    return compute


SPECS = [
    MetricSpec(
        "latency_ms", "operational", "ms", "lower", _field("latency_ms"),
        description="DocuMind's whole turn (scored turn; retrieval-only: the /retrieve call).",
    ),
    MetricSpec(
        "ttft_ms", "operational", "ms", "lower", _field("ttft_ms"),
        run_modes=frozenset({"full"}), description="Time to the first answer token.",
    ),
    MetricSpec(
        "input_tokens", "operational", "count", "lower", _field("input_tokens"),
        description="DocuMind input tokens for the case (setup turns included).",
    ),
    MetricSpec(
        "output_tokens", "operational", "count", "lower", _field("output_tokens"),
        description="DocuMind output tokens for the case (setup turns included).",
    ),
    MetricSpec(
        "documind_cost_usd", "operational", "usd", "lower", _field("cost_usd"),
        description="DocuMind's metered cost for the case (setup turns included).",
    ),
]  # fmt: skip
