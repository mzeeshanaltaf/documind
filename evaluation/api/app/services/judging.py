"""Judging one case: the judge metric groups, each in its own `try`, so a failing group gives its
metrics status `error` (or `refusal`) and the case still completes.

| Group | Prompt(s) | Metrics |
|---|---|---|
| claims | `judge.claims_extract` → `claims_verify` | faithfulness, hallucination, citation_* |
| key facts | `judge.key_facts` (answer, then sources) | key_fact_recall, context_recall |
| relevance | `judge.context_relevance` | context_precision (+ contexts' `judge_relevant`) |
| behaviour | `judge.behavior` | behavior_correct, false_refusal |
| quality | `judge.answer_quality` × samples | answer_quality, answer_quality.* |
| follow-up | `judge.followup_resolution` | followup_resolution |

Control-flow errors are not swallowed: a rate limit (`RetryLater`), the budget stop
(`BudgetExceeded`) and an account-level refusal (`JudgeUnavailable`) end the job so it can be
requeued, and a transient Anthropic error retries the job unless this is its last attempt.
Every paid call is stored, so the retry reuses it.
"""

import asyncio
import dataclasses
import logging
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.judge import client as judge_client
from app.judge import registry
from app.judge.client import (
    BudgetExceeded,
    JudgeCtx,
    JudgeResult,
    JudgeTransientError,
    JudgeUnavailable,
)
from app.judge.registry import PromptSpec
from app.judge.render import CaseInputs, render_packet
from app.metrics import generation
from app.metrics.behavior import REFUSAL_TYPES, behavior_metrics
from app.metrics.generation import (
    CLAIM_METRICS,
    NO_REFERENCE,
    QUALITY_DIMENSIONS,
    VERDICT_VALUE,
    ClaimRow,
)
from app.metrics.registry import REGISTRY, MetricConfig
from app.metrics.safety import is_injection_case, refine_injection
from app.metrics.types import MetricResult, na
from app.worker.errors import RetryLater

logger = logging.getLogger(__name__)

ROLES = ("rubric", "claims")
QUALITY_METRICS = ("answer_quality", *(f"answer_quality.{d}" for d in QUALITY_DIMENSIONS))
GROUPS: dict[str, tuple[str, ...]] = {
    "claims": CLAIM_METRICS,
    "key_facts": ("key_fact_recall", "context_recall"),
    "relevance": ("context_precision",),
    "behavior": ("behavior_correct", "false_refusal", "refusal_rate_oos", "injection_resisted"),
    "quality": QUALITY_METRICS,
    "followup": ("followup_resolution",),
}


@dataclass(frozen=True)
class JudgeConfig:
    """The run's `judge` config: `{enabled, models: {rubric, claims}, samples: 1|3,
    efforts: {rubric, claims}}`. A role without a model/effort uses the prompt file's."""

    enabled: bool = True
    models: Mapping[str, str | None] = field(default_factory=dict)
    efforts: Mapping[str, str | None] = field(default_factory=dict)
    samples: int = 1

    @classmethod
    def from_config(cls, config: Mapping[str, Any] | None) -> "JudgeConfig":
        config = config or {}
        return cls(
            enabled=bool(config.get("enabled", True)),
            models=dict(config.get("models") or {}),
            efforts=dict(config.get("efforts") or {}),
            samples=int(config.get("samples") or 1),
        )

    def model_for(self, spec: PromptSpec) -> str:
        return self.models.get(spec.role) or spec.model

    def effort_for(self, spec: PromptSpec) -> str | None:
        return self.efforts.get(spec.role) or spec.effort


def judging_enabled(run: Any) -> bool:
    """Whether a run's cases go through `case_judge` after generation."""
    if run.mode != "full":
        return False
    if not JudgeConfig.from_config(run.config.get("judge")).enabled:
        return False
    return MetricConfig.from_config(run.config.get("metrics")).needs_judge()


async def prompts_for(session: AsyncSession, snapshot: Mapping[str, Any]) -> dict[str, PromptSpec]:
    """The prompt versions a run recorded at creation; prompts it lacks (a run created before
    E4) come from the current files."""
    refs = dict(snapshot.get("prompts") or {})
    missing = registry.file_keys("judge") - refs.keys()
    if missing:
        current = await registry.sync(session, kind="judge")
        refs.update({key: current[key] for key in missing})
    return {
        key: await registry.load_version(session, uuid.UUID(ref["version_id"]))
        for key, ref in refs.items()
    }


@dataclass
class Judged:
    """A judge metric's result plus the calls behind it."""

    result: MetricResult
    call_ids: list[uuid.UUID] = field(default_factory=list)
    n_samples: int = 1
    spread: float | None = None


@dataclass
class JudgeOutcome:
    scores: dict[str, Judged] = field(default_factory=dict)
    claims: list[ClaimRow] | None = None  # None = the claims group didn't run
    relevance: dict[int, bool] | None = None  # source n → judge_relevant


def _failed(result: JudgeResult) -> MetricResult:
    status = "refusal" if result.status == "refusal" else "error"
    return MetricResult(None, status, {"error": result.error or result.status})


def _ids(*results: JudgeResult) -> list[uuid.UUID]:
    return [r.call_id for r in results if r.call_id is not None]


class Judge:
    """Calls one case's prompts with the run's judge config."""

    def __init__(
        self,
        inputs: CaseInputs,
        prompts: Mapping[str, PromptSpec],
        config: JudgeConfig,
        ctx: JudgeCtx,
    ) -> None:
        self.inputs, self.prompts, self.config, self.ctx = inputs, prompts, config, ctx

    async def call(
        self, key: str, task_values: dict[str, str] | None = None, *, sample_idx: int = 0,
        purpose: str | None = None, cache_packet: bool = False,
    ) -> JudgeResult:  # fmt: skip
        spec = self.prompts[key]
        return await judge_client.call(
            spec,
            render_packet(spec.packet, self.inputs),
            spec.render_task(task_values),
            ctx=self.ctx,
            purpose=purpose or key,
            sample_idx=sample_idx,
            model=self.config.model_for(spec),
            effort=self.config.effort_for(spec),
            cache_packet=cache_packet,
        )

    # --- groups --------------------------------------------------------------------------

    async def claims(self, outcome: JudgeOutcome) -> dict[str, Judged]:
        extract = await self.call("judge.claims_extract")
        if not extract.ok:
            return {k: Judged(_failed(extract), _ids(extract)) for k in CLAIM_METRICS}
        extracted = extract.output.claims  # type: ignore[union-attr]
        if not extracted:
            outcome.claims = []
            return {
                key: Judged(result, _ids(extract))
                for key, result in generation.claim_metrics([]).items()
            }
        listing = "\n".join(f"{i}. {c.text}" for i, c in enumerate(extracted, start=1))
        verify = await self.call("judge.claims_verify", {"claims": listing})
        verdicts = {v.idx: v for v in verify.output.verdicts} if verify.ok else {}  # type: ignore[union-attr]
        claims = []
        for i, claim in enumerate(extracted, start=1):
            verdict = verdicts.get(i)
            claims.append(
                ClaimRow(
                    idx=i,
                    text=claim.text,
                    sentence_idx=claim.sentence_idx,
                    citation_ns=tuple(dict.fromkeys(claim.citation_ns)),
                    verdict=verdict.verdict if verdict else None,
                    supporting_ns=tuple(dict.fromkeys(verdict.supporting_ns)) if verdict else (),
                    evidence_quote=verdict.evidence_quote if verdict else None,
                    reasoning=verdict.reasoning if verdict else None,
                )
            )
        outcome.claims = claims
        ids = _ids(extract, verify)
        if not verify.ok:
            return {k: Judged(_failed(verify), ids) for k in CLAIM_METRICS}
        results = generation.claim_metrics(
            # A claim the verifier skipped counts as not found.
            [c if c.verdict else dataclasses.replace(c, verdict="not_found") for c in claims]
        )
        skipped = [c.idx for c in claims if c.verdict is None]
        if skipped:
            results["faithfulness"].details["missing_verdicts"] = skipped
        return {key: Judged(result, ids) for key, result in results.items()}

    async def key_facts(self, _outcome: JudgeOutcome) -> dict[str, Judged]:
        case = self.inputs.case
        weights = generation.fact_weights(case)
        if not weights:
            return {k: Judged(na(NO_REFERENCE)) for k in GROUPS["key_facts"]}
        targets = {"key_fact_recall": "the <answer>", "context_recall": "the <sources>"}
        # One after the other: the second call reads the packet the first one cached.
        results = [
            await self.call(
                "judge.key_facts",
                {"target": target},
                purpose=f"judge.key_facts:{key}",
                cache_packet=True,
            )  # fmt: skip
            for key, target in targets.items()
        ]
        judged = {}
        for key, result in zip(targets, results, strict=True):
            if not result.ok:
                judged[key] = Judged(_failed(result), _ids(result))
                continue
            entailed = {f.idx: f.entailed for f in result.output.facts}  # type: ignore[union-attr]
            judged[key] = Judged(generation.key_fact_recall(weights, entailed), _ids(result))
        return judged

    async def relevance(self, outcome: JudgeOutcome) -> dict[str, Judged]:
        contexts = list(self.inputs.contexts)
        if not self.inputs.case.answering:
            return {"context_precision": Judged(na("not applicable"))}
        if not contexts:
            return {"context_precision": Judged(na("no_contexts"))}
        result = await self.call("judge.context_relevance", {"n_sources": str(len(contexts))})
        if not result.ok:
            return {"context_precision": Judged(_failed(result), _ids(result))}
        judged = {c.n: c.relevant for c in result.output.chunks}  # type: ignore[union-attr]
        outcome.relevance = {c.n: bool(judged.get(c.n, False)) for c in contexts}
        ranked = [outcome.relevance[c.n] for c in sorted(contexts, key=lambda c: c.rank)]
        value = generation.average_precision(ranked)
        details = {
            "relevant": sum(ranked),
            "sources": len(ranked),
            "relevant_ns": [c.n for c in contexts if outcome.relevance[c.n]],
            "missing_verdicts": [c.n for c in contexts if c.n not in judged],
        }
        return {"context_precision": Judged(MetricResult(value, "ok", details), _ids(result))}

    async def behavior(self, _outcome: JudgeOutcome) -> dict[str, Judged]:
        case = self.inputs.case
        result = await self.call("judge.behavior")
        keys = ["behavior_correct"] + (["false_refusal"] if case.answering else [])
        if case.type in REFUSAL_TYPES:
            keys.append("refusal_rate_oos")
        if not result.ok:
            failed = {k: Judged(_failed(result), _ids(result)) for k in keys}
            if is_injection_case(case):
                # The canary and fingerprint checks still stand without the verdict.
                failed["injection_resisted"] = Judged(
                    refine_injection(case, self.inputs.answer, None), _ids(result)
                )
            return failed
        metrics = behavior_metrics(case, result.output, self.inputs.answer)
        return {key: Judged(value, _ids(result)) for key, value in metrics.items()}

    async def quality(self, _outcome: JudgeOutcome) -> dict[str, Judged]:
        # With N > 1 the first sample writes the packet cache; the others then read it.
        reuse = self.config.samples > 1
        first = await self.call("judge.answer_quality", cache_packet=reuse)
        rest = await asyncio.gather(
            *(
                self.call("judge.answer_quality", sample_idx=i, cache_packet=reuse)
                for i in range(1, self.config.samples)
            )
        )
        results = [first, *rest]
        ids = _ids(*results)
        samples = [r.output for r in results if r.ok]
        if not samples:
            return {k: Judged(_failed(first), ids) for k in QUALITY_METRICS}
        details = generation.quality_details(samples[0])
        if len(results) > 1:
            details["sample_verdicts"] = [s.verdict for s in samples]  # type: ignore[union-attr]
            details["failed_samples"] = len(results) - len(samples)
        verdict, spread = generation.median_and_spread(
            [VERDICT_VALUE[s.verdict] for s in samples]  # type: ignore[union-attr]
        )
        judged = {"answer_quality": Judged(MetricResult(verdict, "ok", details), ids,
                                           len(samples), spread)}  # fmt: skip
        has_reference = self.inputs.case.has_reference
        for dimension in QUALITY_DIMENSIONS:
            key = f"answer_quality.{dimension}"
            if dimension == "correctness" and not has_reference:
                judged[key] = Judged(na(NO_REFERENCE), ids, len(samples))
                continue
            scores = [
                getattr(s.scores, dimension)  # type: ignore[union-attr]
                for s in samples
                if getattr(s.scores, dimension) is not None  # type: ignore[union-attr]
            ]
            if not scores:
                judged[key] = Judged(na("not_scored"), ids, len(samples))
                continue
            median, spread = generation.median_and_spread([float(s) for s in scores])
            result = MetricResult(
                generation.normalize_score(median),
                "ok",
                {"score": median, "samples": scores, "analysis": getattr(
                    samples[0].analysis, dimension)},  # type: ignore[union-attr]
            )  # fmt: skip
            judged[key] = Judged(result, ids, len(scores), spread)
        return judged

    async def followup(self, _outcome: JudgeOutcome) -> dict[str, Judged]:
        if not self.inputs.case.setup_turns:
            return {"followup_resolution": Judged(na("not applicable"))}
        result = await self.call("judge.followup_resolution")
        if not result.ok:
            return {"followup_resolution": Judged(_failed(result), _ids(result))}
        output = result.output
        value = generation.normalize_score(output.score)  # type: ignore[union-attr]
        details = {
            "score": output.score,  # type: ignore[union-attr]
            "resolved": output.resolved,  # type: ignore[union-attr]
            "reasoning": output.reasoning,  # type: ignore[union-attr]
            "standalone_query": (self.inputs.routing or {}).get("standalone_query"),
        }
        return {"followup_resolution": Judged(MetricResult(value, "ok", details), _ids(result))}


CONTROL = (RetryLater, BudgetExceeded, JudgeUnavailable)


async def judge_case(
    inputs: CaseInputs,
    prompts: Mapping[str, PromptSpec],
    metrics: MetricConfig,
    config: JudgeConfig,
    ctx: JudgeCtx,
    *,
    last_attempt: bool = False,
) -> JudgeOutcome:
    """Every enabled judge metric for one case. Groups run concurrently; see the module doc for
    how errors are handled."""
    enabled = metrics.enabled_judge_metrics()
    judge = Judge(inputs, prompts, config, ctx)
    runners: dict[str, Callable[[JudgeOutcome], Awaitable[dict[str, Judged]]]] = {
        "claims": judge.claims,
        "key_facts": judge.key_facts,
        "relevance": judge.relevance,
        "behavior": judge.behavior,
        "quality": judge.quality,
        "followup": judge.followup,
    }
    groups = [name for name, keys in GROUPS.items() if enabled & set(keys)]
    outcome = JudgeOutcome()
    results = await asyncio.gather(
        *(runners[name](outcome) for name in groups), return_exceptions=True
    )
    for exc_type in CONTROL:
        found = next((r for r in results if isinstance(r, exc_type)), None)
        if found is not None:
            raise found
    if not last_attempt:
        transient = next((r for r in results if isinstance(r, JudgeTransientError)), None)
        if transient is not None:
            raise transient
    for name, result in zip(groups, results, strict=True):
        if isinstance(result, BaseException):
            if not isinstance(result, Exception):
                raise result
            logger.error(
                "Judge group %s failed on case %s: %s", name, inputs.case.case_key, result,
                exc_info=result,
            )  # fmt: skip
            error = MetricResult(None, "error", {"error": f"{type(result).__name__}: {result}"})
            result = {key: Judged(error) for key in GROUPS[name]}
        outcome.scores.update(result)
    outcome.scores = _applicable(outcome.scores, inputs, enabled)
    return outcome


def _applicable(
    scores: dict[str, Judged], inputs: CaseInputs, enabled: frozenset[str]
) -> dict[str, Judged]:
    """Only enabled metrics; a metric that doesn't apply to the case is `na`."""
    kept = {}
    for key, judged in scores.items():
        if key not in enabled:
            continue
        spec = REGISTRY[key]
        if not spec.applies_to(inputs.case) and judged.result.status == "ok":
            judged = Judged(na("not applicable"), judged.call_ids)
        kept[key] = judged
    return kept
