"""Every metric the harness computes, keyed by name, plus how a run's `metrics` config selects
them, sets thresholds and decides which ones gate a case.

Run config: `{"enabled": [keys] | null (= all), "thresholds": {key: value}, "gates": [keys] | null
(= the specs' defaults)}`. A case passes when every gating metric that applies to it passes
(`na` and `refusal` are ignored, `error` fails). Judge metrics (`requires_judge`) are listed here
too, but computed by the `case_judge` job (`services/judging.py`), not by `evaluate`.
"""

import logging
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.metrics import behavior, citations, generation, operational, retrieval, safety
from app.metrics.types import (
    CaseOutput,
    CaseSpec,
    Context,
    MetricResult,
    MetricSpec,
    na,
)

logger = logging.getLogger(__name__)

REGISTRY: dict[str, MetricSpec] = {
    spec.key: spec
    for spec in (
        *retrieval.SPECS,
        *citations.SPECS,
        *operational.SPECS,
        *safety.SPECS,
        *behavior.SPECS,
        *generation.SPECS,
    )
}
JUDGE_METRICS = frozenset(key for key, spec in REGISTRY.items() if spec.requires_judge)
DEFAULT_GATES = frozenset(key for key, spec in REGISTRY.items() if spec.gating)


class UnknownMetricError(ValueError):
    def __init__(self, keys: Iterable[str]) -> None:
        self.keys = sorted(keys)
        super().__init__(f"Unknown metric(s): {', '.join(self.keys)}")


def check_keys(keys: Iterable[str]) -> None:
    unknown = set(keys) - REGISTRY.keys()
    if unknown:
        raise UnknownMetricError(unknown)


@dataclass(frozen=True)
class MetricConfig:
    enabled: frozenset[str] | None = None
    thresholds: Mapping[str, float] = field(default_factory=dict)
    gates: frozenset[str] = DEFAULT_GATES

    @classmethod
    def from_config(cls, config: Mapping[str, Any] | None) -> "MetricConfig":
        config = config or {}
        enabled = config.get("enabled")
        gates = config.get("gates")
        return cls(
            enabled=frozenset(enabled) if enabled is not None else None,
            thresholds=dict(config.get("thresholds") or {}),
            gates=frozenset(gates) if gates is not None else DEFAULT_GATES,
        )

    def is_enabled(self, spec: MetricSpec) -> bool:
        return self.enabled is None or spec.key in self.enabled

    def threshold(self, spec: MetricSpec) -> float | None:
        return self.thresholds.get(spec.key, spec.default_threshold)

    def needs_judge(self) -> bool:
        return any(spec.requires_judge and self.is_enabled(spec) for spec in REGISTRY.values())

    def enabled_judge_metrics(self) -> frozenset[str]:
        """The metrics a judge job may write: judge metrics and judge-refined ones."""
        return frozenset(
            key
            for key, spec in REGISTRY.items()
            if (spec.requires_judge or spec.judge_refined) and self.is_enabled(spec)
        )


@dataclass(frozen=True)
class Score:
    metric: str
    mode: str
    value: float | None
    status: str
    passed: bool | None
    details: dict[str, Any]


def evaluate(
    case: CaseSpec,
    output: CaseOutput,
    contexts: Sequence[Context],
    config: MetricConfig,
) -> list[Score]:
    """Every enabled deterministic metric for one case in one mode. A metric that doesn't apply
    is kept as `na` (so aggregates can count it); a crashing metric becomes `error`. An
    `authz_probe` case sends no question, so it only gets the probe metric."""
    scores = []
    probe_case = case.type == "authz_probe"
    for spec in REGISTRY.values():
        if spec.requires_judge or not config.is_enabled(spec):
            continue
        if output.run_mode not in spec.run_modes:
            continue
        if probe_case and spec.key not in safety.PROBE_METRICS:
            continue
        if not spec.applies_to(case):
            result = na("not applicable")
        else:
            try:
                result = spec.compute(case, output, contexts)
            except Exception as exc:  # noqa: BLE001 — one bad metric mustn't lose the case
                logger.exception("Metric %s failed on case %s", spec.key, case.case_key)
                result = MetricResult(None, "error", {"error": f"{type(exc).__name__}: {exc}"})
        passed = (
            spec.passes(result.value, config.threshold(spec)) if result.status == "ok" else None
        )
        scores.append(
            Score(spec.key, output.mode, result.value, result.status, passed, result.details)
        )
    return scores


def case_passed(scores: Iterable[Score], gates: frozenset[str]) -> bool:
    for score in scores:
        if score.metric not in gates:
            continue
        if score.status == "error" or (score.status == "ok" and score.passed is False):
            return False
    return True


def describe() -> list[dict[str, Any]]:
    """The registry for the web (`GET /v1/metrics`)."""
    return [
        {
            "key": spec.key,
            "group": spec.group,
            "scale": spec.scale,
            "direction": spec.direction,
            "default_threshold": spec.default_threshold,
            "gating": spec.gating,
            "requires_judge": spec.requires_judge,
            "judge_refined": spec.judge_refined,
            "run_modes": sorted(spec.run_modes),
            "description": spec.description,
        }
        for spec in REGISTRY.values()
    ]
