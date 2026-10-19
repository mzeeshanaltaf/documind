"""What one case produced (`Generated`) and how it is stored: the run case's answer, routing,
usage and trace, its retrieved contexts per mode, and its deterministic metric scores. Saving is
one transaction that also counts the case, so a retry after a crash either finds the case done
or redoes all of it."""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.metrics.registry import MetricConfig, Score, case_passed, evaluate
from app.metrics.retrieval import is_relevant
from app.metrics.types import CaseOutput, CaseSpec, Context
from app.models import Case, MetricScore, RetrievedContext, Run, RunCase
from app.services import run_state


@dataclass
class Generated:
    """DocuMind's output for one case. `contexts` maps a retrieval mode to its source dicts
    (`Source.as_dict()` shape); a full run has one entry, the chat's retrieval mode."""

    answer: str | None = None
    routing: dict[str, Any] | None = None
    citations: list[dict[str, Any]] = field(default_factory=list)
    needs_clarification: bool = False
    contexts: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    top_k: int = 8
    latency_ms: int | None = None
    ttft_ms: int | None = None
    input_tokens: int | None = None
    cached_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float = 0.0
    usage: dict[str, Any] = field(default_factory=dict)
    trace: dict[str, Any] = field(default_factory=dict)


def to_context(rank: int, source: Mapping[str, Any]) -> Context:
    return Context(
        rank=rank,
        n=int(source.get("n") or rank),
        document_id=_str(source.get("document_id")),
        doc_code=source.get("doc_code"),
        section_number=source.get("section_number"),
        section_title=source.get("section_title"),
        page_start=source.get("page_start"),
        page_end=source.get("page_end"),
        text=source.get("text"),
        chunk_id=_str(source.get("chunk_id")),
    )


def _str(value: Any) -> str | None:
    return None if value is None else str(value)


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


def context_rows(
    run_case_id: uuid.UUID,
    mode: str,
    sources: Sequence[Mapping[str, Any]],
    case: CaseSpec,
    cited_ns: set[int] | None,
) -> list[RetrievedContext]:
    rows = []
    for rank, source in enumerate(sources, start=1):
        scores = source.get("scores") or {}
        n = int(source.get("n") or rank)
        rows.append(
            RetrievedContext(
                id=uuid.uuid4(),
                run_case_id=run_case_id,
                mode=mode,
                rank=rank,
                n=n,
                chunk_id=_uuid(source.get("chunk_id")),
                document_id=_uuid(source.get("document_id")),
                doc_code=source.get("doc_code"),
                section_number=source.get("section_number"),
                section_title=source.get("section_title"),
                section_path=list(source.get("section_path") or []),
                page_start=source.get("page_start"),
                page_end=source.get("page_end"),
                content_type=source.get("content_type"),
                department=source.get("department"),
                jurisdiction=source.get("jurisdiction"),
                text=source.get("text"),
                bm25_rank=scores.get("bm25_rank"),
                vector_rank=scores.get("vector_rank"),
                rrf=scores.get("rrf"),
                score=scores.get("score"),
                part=scores.get("part"),
                label_relevant=(
                    is_relevant(source.get("doc_code"), source.get("section_number"), case)
                    if case.expected_doc_codes
                    else None
                ),
                cited=(n in cited_ns) if cited_ns is not None else None,
            )
        )
    return rows


def score_all(run: Run, case: CaseSpec, generated: Generated, config: MetricConfig) -> list[Score]:
    """Deterministic metrics: once (`chat`) for a full run, once per mode for retrieval-only."""
    snapshot_ids = (run.snapshot.get("documents") or {}).get("ids")
    common = {
        "run_mode": run.mode,
        "answer": generated.answer,
        "routing": generated.routing,
        "citations": generated.citations,
        "needs_clarification": generated.needs_clarification,
        "latency_ms": generated.latency_ms,
        "ttft_ms": generated.ttft_ms,
        "input_tokens": generated.input_tokens,
        "output_tokens": generated.output_tokens,
        "cost_usd": generated.cost_usd,
        "top_k": generated.top_k,
        "org_document_ids": frozenset(snapshot_ids) if snapshot_ids is not None else None,
        "canary_phrases": tuple(run.config.get("canary_phrases") or ()),
    }
    scores: list[Score] = []
    for mode, sources in generated.contexts.items():
        metric_mode = "chat" if run.mode == "full" else mode
        contexts = [to_context(rank, s) for rank, s in enumerate(sources, start=1)]
        output = CaseOutput(mode=metric_mode, **common)
        scores.extend(evaluate(case, output, contexts, config))
    return scores


async def save_generated(
    run: Run, run_case_id: uuid.UUID, case: Case, generated: Generated
) -> bool:
    """Store the outcome, score it and count the case, in one transaction. Returns False when
    the case was already terminal (a duplicate delivery), in which case nothing changes."""
    spec = CaseSpec.from_model(case)
    config = MetricConfig.from_config(run.config.get("metrics"))
    scores = score_all(run, spec, generated, config)
    passed = case_passed(scores, config.gates)
    cited_ns = {int(c["n"]) for c in generated.citations if c.get("n") is not None}

    async with session_scope() as session:
        run_case = (
            await session.execute(
                select(RunCase).where(RunCase.id == run_case_id).with_for_update()
            )
        ).scalar_one_or_none()
        if run_case is None or run_case.status in run_state.CASE_TERMINAL:
            return False
        await _replace_children(session, run_case_id)
        for mode, sources in generated.contexts.items():
            session.add_all(
                context_rows(
                    run_case_id, mode, sources, spec, cited_ns if run.mode == "full" else None
                )
            )
        session.add_all(
            MetricScore(
                id=uuid.uuid4(),
                run_case_id=run_case_id,
                metric=score.metric,
                mode=score.mode,
                value=score.value,
                passed=score.passed,
                status=score.status,
                details=score.details,
            )
            for score in scores
        )
        cost = Decimal(str(generated.cost_usd or 0))
        run_case.answer = generated.answer
        run_case.routing = generated.routing
        run_case.citations = generated.citations
        run_case.needs_clarification = generated.needs_clarification
        run_case.latency_ms = generated.latency_ms
        run_case.ttft_ms = generated.ttft_ms
        run_case.input_tokens = generated.input_tokens
        run_case.cached_tokens = generated.cached_tokens
        run_case.output_tokens = generated.output_tokens
        run_case.documind_cost_usd = cost
        run_case.documind_usage = generated.usage
        run_case.trace = generated.trace
        run_case.passed = passed
        run_case.error_stage = None
        run_case.error = None
        # Judge metrics (E4) would stop at `generated` and enqueue `case_judge` here.
        run_case.status = "done"
        await session.flush()
        await run_state.count_case(session, run.id, outcome="done", passed=passed, cost_usd=cost)
    return True


async def _replace_children(session: AsyncSession, run_case_id: uuid.UUID) -> None:
    await session.execute(
        delete(RetrievedContext).where(RetrievedContext.run_case_id == run_case_id)
    )
    await session.execute(delete(MetricScore).where(MetricScore.run_case_id == run_case_id))
