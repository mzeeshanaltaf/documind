"""What one case produced (`Generated`) and how it is stored: the run case's answer, routing,
usage and trace, its retrieved contexts per mode, and its deterministic metric scores. Saving is
one transaction that also counts the case, so a retry after a crash either finds the case done
or redoes all of it.

When the run judges (`judging.judging_enabled`), saving stops the case at `generated` and
enqueues its `case_judge` job instead; `save_judged` then stores the judge's scores and claims,
decides `passed` over every score, and counts the case."""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import bindparam, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.metrics.registry import REGISTRY, MetricConfig, Score, case_passed, evaluate
from app.metrics.retrieval import is_relevant
from app.metrics.types import CaseOutput, CaseSpec, Context
from app.models import Case, Claim, MetricScore, RetrievedContext, Run, RunCase
from app.services import run_state
from app.services.judging import JudgeOutcome, judging_enabled
from app.worker import queue

JUDGE_ATTEMPTS = 4  # case_judge: transient Anthropic errors back off 10 s, 20 s, 40 s
JUDGE_PRIORITY = 1  # finish judging started cases before generating new ones


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
    probes: list[dict[str, Any]] | None = None  # authz_probe cases: one result per request


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
        title=source.get("title"),
        jurisdiction=source.get("jurisdiction"),
    )


def context_from_row(row: RetrievedContext) -> Context:
    return Context(
        rank=row.rank,
        n=row.n,
        document_id=_str(row.document_id),
        doc_code=row.doc_code,
        section_number=row.section_number,
        section_title=row.section_title,
        page_start=row.page_start,
        page_end=row.page_end,
        text=row.text,
        chunk_id=_str(row.chunk_id),
        title=row.title,
        jurisdiction=row.jurisdiction,
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
                title=source.get("title"),
                owner=source.get("owner"),
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


def canary_phrases(run: Run) -> tuple[str, ...]:
    """The leakage canary's phrases from the run's snapshot, plus any the run asked for."""
    snapshot = (run.snapshot.get("canary") or {}).get("phrases") or []
    return tuple(dict.fromkeys([*snapshot, *(run.config.get("canary_phrases") or [])]))


def score_all(run: Run, case: CaseSpec, generated: Generated, config: MetricConfig) -> list[Score]:
    """Deterministic metrics: once (`chat`) for a full run, once per mode for retrieval-only."""
    documents = run.snapshot.get("documents") or {}
    snapshot_ids = documents.get("ids")
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
        "canary_phrases": canary_phrases(run),
        "supplements": documents.get("supplements"),
        "probes": generated.probes,
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
    """Store the outcome, score it and count the case (or hand it to the judge), in one
    transaction. Returns False when the case was already terminal (a duplicate delivery), in
    which case nothing changes."""
    spec = CaseSpec.from_model(case)
    config = MetricConfig.from_config(run.config.get("metrics"))
    scores = score_all(run, spec, generated, config)
    # A probe case has no answer to judge.
    judging = judging_enabled(run) and spec.type != "authz_probe"
    passed = None if judging else case_passed(scores, config.gates)
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
        if judging:
            run_case.status = "generated"
            await session.flush()
            await queue.enqueue(
                session,
                "case_judge",
                run_id=run.id,
                run_case_id=run_case_id,
                priority=JUDGE_PRIORITY,
                max_attempts=JUDGE_ATTEMPTS,
            )
            return True
        run_case.status = "done"
        await session.flush()
        await run_state.count_case(session, run.id, outcome="done", passed=passed, cost_usd=cost)
    return True


async def _replace_children(session: AsyncSession, run_case_id: uuid.UUID) -> None:
    await session.execute(
        delete(RetrievedContext).where(RetrievedContext.run_case_id == run_case_id)
    )
    await session.execute(delete(MetricScore).where(MetricScore.run_case_id == run_case_id))
    await session.execute(delete(Claim).where(Claim.run_case_id == run_case_id))


def _score_of(row: MetricScore) -> Score:
    return Score(row.metric, row.mode, row.value, row.status, row.passed, row.details)


async def save_judged(run: Run, run_case_id: uuid.UUID, outcome: JudgeOutcome) -> bool:
    """Store the judge's scores, claims and source relevance, decide `passed` over every score
    of the case, mark it done and count it, in one transaction. False = already terminal."""
    config = MetricConfig.from_config(run.config.get("metrics"))
    judged_keys = list(outcome.scores)
    async with session_scope() as session:
        run_case = (
            await session.execute(
                select(RunCase).where(RunCase.id == run_case_id).with_for_update()
            )
        ).scalar_one_or_none()
        if run_case is None or run_case.status in run_state.CASE_TERMINAL:
            return False
        await session.execute(
            delete(MetricScore).where(
                MetricScore.run_case_id == run_case_id, MetricScore.metric.in_(judged_keys)
            )
        )
        rows = []
        for key, judged in outcome.scores.items():
            result = judged.result
            passed = (
                REGISTRY[key].passes(result.value, config.threshold(REGISTRY[key]))
                if result.status == "ok"
                else None
            )
            rows.append(
                MetricScore(
                    id=uuid.uuid4(),
                    run_case_id=run_case_id,
                    metric=key,
                    mode="chat",
                    value=result.value,
                    passed=passed,
                    status=result.status,
                    n_samples=judged.n_samples,
                    spread=judged.spread,
                    details=result.details,
                    judge_call_ids=judged.call_ids,
                )
            )
        session.add_all(rows)
        if outcome.claims is not None:
            await session.execute(delete(Claim).where(Claim.run_case_id == run_case_id))
            session.add_all(
                Claim(
                    id=uuid.uuid4(),
                    run_case_id=run_case_id,
                    idx=claim.idx,
                    text=claim.text,
                    sentence_idx=claim.sentence_idx,
                    citation_ns=list(claim.citation_ns),
                    verdict=claim.verdict,
                    supporting_ns=list(claim.supporting_ns),
                    evidence_quote=claim.evidence_quote,
                    reasoning=claim.reasoning,
                )
                for claim in outcome.claims
            )
        if outcome.relevance:
            table = RetrievedContext.__table__
            await session.execute(
                update(table)
                .where(table.c.run_case_id == run_case_id, table.c.n == bindparam("source_n"))
                .values(judge_relevant=bindparam("relevant")),
                [{"source_n": n, "relevant": rel} for n, rel in outcome.relevance.items()],
            )
        await session.flush()
        stored = (
            await session.scalars(select(MetricScore).where(MetricScore.run_case_id == run_case_id))
        ).all()
        passed = case_passed([_score_of(row) for row in stored], config.gates)
        run_case.passed = passed
        run_case.status = "done"
        run_case.error_stage = None
        run_case.error = None
        await session.flush()
        # A rejudge made no DocuMind calls, so its run doesn't add their (copied) cost.
        cost = Decimal(0) if run.source_run_id else run_case.documind_cost_usd
        await run_state.count_case(session, run.id, outcome="done", passed=passed, cost_usd=cost)
    return True
