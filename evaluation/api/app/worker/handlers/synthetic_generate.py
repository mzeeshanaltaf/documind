"""`synthetic_generate`: fill one candidate of a synthetic batch.

New cases (`kind=synthetic`): `gen.<type>` (Opus 5.5, effort high) writes the case from the seed
chunks (or, chunkless, from the org's catalog and a hint) → an `unanswerable` question is run
through DocuMind's `/retrieve` (hybrid) → `gen.validate` (Sonnet 5.5, medium) checks it against
the seed chunks or the retrieved contexts → the deterministic checks
(`services/synthetic_checks.py`) → saved. A hard failure auto-rejects the candidate with the
reason; a human can still restore it.

Enrichment (`kind=enrichment`): the case's expected-section chunks (retrieved within its expected
documents when it names no sections) → `gen.enrich_reference` → `gen.validate` (advisory) →
saved as a candidate for the case's `target_case_key`.

Every Anthropic call goes through `judge.client.call` with the batch's context: metered in
`judge_calls` (purpose `synthetic`), reused on a retry, capped by the batch's `max_cost_usd`
(the batch pauses; the job waits until it's resumed). Fields the seed decides are set
deterministically, not taken from the model: `expected_behavior` (by type), pages and
departments (from the chunks of the expected sections), and the jurisdiction of jurisdiction,
comparative and out-of-scope cases.
"""

import logging
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text

from app.core.db import session_scope
from app.documind.client import DocuMindError, get_documind
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
from app.judge.render import defuse
from app.judge.schemas import CandidateValidation, EnrichedReference, GeneratedCase
from app.models import SyntheticBatch, SyntheticCandidate
from app.services import synthetic, synthetic_checks
from app.worker.errors import RetryLater
from app.worker.limits import documind_limiter
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)

PURPOSE = "synthetic"
CATALOG_TYPES = frozenset({"unanswerable", "out_of_scope"})
RETRIEVE_TOP_K = 8
ENRICH_RETRIEVE_TOP_K = 4


# --- rendering (pure) --------------------------------------------------------------------------


def chunk_header(e: Mapping[str, Any]) -> str:
    """`[n] CODE · title (country) · §n section · p.x-y · department` (the country only for
    country supplements; `_gen_rules.md` describes this format)."""
    title = e.get("title") or ""
    if e.get("jurisdiction"):
        title += f" ({e['jurisdiction']})"
    parts = [f"[{e.get('n')}] {e.get('doc_code') or 'Document'}", title]
    section = " ".join(
        p for p in (f"§{e['section_number']}" if e.get("section_number") else None,
                    e.get("section_title")) if p
    )  # fmt: skip
    if section:
        parts.append(section)
    if e.get("page_start") is not None:
        pages = f"p.{e['page_start']}"
        if e.get("page_end") and e["page_end"] != e["page_start"]:
            pages += f"-{e['page_end']}"
        parts.append(pages)
    if e.get("department"):
        parts.append(str(e["department"]))
    return " · ".join(parts)


def render_chunks(excerpts: Sequence[Mapping[str, Any]]) -> str:
    if not excerpts:
        return "<chunks>\n(no excerpts)\n</chunks>"
    body = "\n\n".join(f"{chunk_header(e)}\n{defuse(e.get('text') or '')}" for e in excerpts)
    return f"<chunks>\n{body}\n</chunks>"


def render_catalog(entries: Sequence[Mapping[str, Any]]) -> str:
    lines = []
    for doc in entries:
        head = f"{doc.get('doc_code')} · {doc.get('title')}"
        if doc.get("jurisdiction"):
            head += f" ({doc['jurisdiction']})"
        if doc.get("department"):
            head += f" · {doc['department']}"
        lines.append(head)
        lines.extend(f"  §{number} {title}" for number, title in doc.get("sections") or [])
    return "<catalog>\n" + defuse("\n".join(lines)) + "\n</catalog>"


def render_candidate(
    *,
    type: str,
    question: str,
    expected_behavior: str | None = None,
    jurisdiction: str | None = None,
    reference_answer: str | None = None,
    key_facts: Sequence[Mapping[str, Any]] = (),
) -> str:
    lines = [f"Type: {type}", f"Question: {question}"]
    if jurisdiction:
        lines.append(f"Country: {jurisdiction}")
    if expected_behavior:
        lines.append(f"Expected behaviour: {expected_behavior}")
    if reference_answer is not None:
        lines.append(f"Reference answer: {reference_answer}")
        lines.append("Key facts:")
        lines.extend(
            f"{i}. {fact.get('fact')} (weight {fact.get('weight', 1)})"
            for i, fact in enumerate(key_facts, start=1)
        )
    return "<candidate>\n" + defuse("\n".join(lines)) + "\n</candidate>"


# --- deterministic fields (pure) ---------------------------------------------------------------


def pages_for(sections: Sequence[str], excerpts: Sequence[Mapping[str, Any]]) -> list[dict] | None:
    """Page ranges of the expected sections' chunks, per document (`citations.expected_pages`
    accepts `{doc_code, page_start, page_end}` items)."""
    out: dict[tuple[str, int, int], dict] = {}
    for e in excerpts:
        key = synthetic_checks.section_key(e.get("doc_code"), e.get("section_number"))
        if key in sections and e.get("page_start") is not None:
            start, end = int(e["page_start"]), int(e.get("page_end") or e["page_start"])
            out.setdefault(
                (e["doc_code"], start, end),
                {"doc_code": e["doc_code"], "page_start": start, "page_end": end},
            )
    return [out[k] for k in sorted(out)] or None


def departments_for(codes: Sequence[str], excerpts: Sequence[Mapping[str, Any]]) -> list[str]:
    seen: dict[str, None] = {}
    for e in excerpts:
        if e.get("doc_code") in codes and e.get("department"):
            seen.setdefault(str(e["department"]), None)
    return list(seen)


def jurisdiction_for(
    type: str, generated: str | None, codes: Sequence[str], excerpts: Sequence[Mapping[str, Any]]
) -> str | None:
    """The seed decides: a jurisdiction case is about its supplement's country; comparative and
    out-of-scope cases have none; otherwise the one country supplement among the expected
    documents, if any. An unanswerable question keeps the country it names."""
    local = {
        e["jurisdiction"] for e in excerpts if e.get("jurisdiction") and e.get("doc_code") in codes
    }
    if type in ("comparative", "out_of_scope"):
        return None
    if type == "jurisdiction":
        seeded = [e["jurisdiction"] for e in excerpts if e.get("jurisdiction")]
        return seeded[0] if seeded else generated
    if type == "unanswerable":
        return generated if generated and generated.isalpha() and len(generated) == 2 else None
    return next(iter(local)) if len(local) == 1 else None


def normalize(
    type: str, output: GeneratedCase, excerpts: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    refusing = type in synthetic.REFUSING_TYPES
    codes = [] if refusing else list(dict.fromkeys(output.expected_doc_codes))
    sections = [] if refusing else list(dict.fromkeys(s.strip() for s in output.expected_sections))
    return {
        "question": output.question.strip(),
        "reference_answer": output.reference_answer.strip(),
        "key_facts": [
            {"fact": f.fact.strip(), "weight": float(f.weight)} for f in output.key_facts
        ],
        "evidence_quotes": [q for q in output.evidence_quotes if q.strip()],
        "expected_doc_codes": codes,
        "expected_sections": sections,
        "expected_pages": pages_for(sections, excerpts),
        "expected_departments": departments_for(codes, excerpts),
        "expected_jurisdiction": jurisdiction_for(
            type, output.expected_jurisdiction, codes, excerpts
        ),
        "expected_behavior": "refuse" if refusing else "answer",
        "rationale": output.rationale.strip(),
    }


def validation_dict(result: JudgeResult) -> dict[str, Any]:
    if not result.ok:
        return {"status": result.status, "error": result.error}
    assert isinstance(result.output, CandidateValidation)
    return {"status": "ok", "model": result.model_actual, **result.output.model_dump()}


# --- the job -----------------------------------------------------------------------------------


@dataclass
class State:
    batch: SyntheticBatch
    candidate: SyntheticCandidate
    prompts: dict[str, PromptSpec]
    ctx: JudgeCtx
    last_attempt: bool


async def handle(job: ClaimedJob) -> None:
    state = await begin(job)
    if state is None:
        return
    try:
        if state.batch.kind == "enrichment":
            fields, checks = await enrich(state)
        else:
            fields, checks = await generate(state)
    except BudgetExceeded as exc:
        raise RetryLater(timedelta(0), "batch cost cap reached") from exc
    except JudgeUnavailable as exc:
        await pause(state.batch.id, "judge_unavailable")
        raise RetryLater(timedelta(0), f"judge unavailable: {exc}") from exc
    except JudgeTransientError:
        if not state.last_attempt:
            raise
        fields, checks = {}, {"generation_error": "Anthropic kept failing (5xx)"}
    await save(state, fields, checks)


async def begin(job: ClaimedJob) -> State | None:
    candidate_id = uuid.UUID(str((job.payload or {}).get("candidate_id")))
    async with session_scope() as session:
        batch = await session.get(SyntheticBatch, job.batch_id) if job.batch_id else None
        candidate = await session.get(SyntheticCandidate, candidate_id)
        if batch is None or candidate is None or candidate.gen_status != "queued":
            return None
        if batch.status == "paused":
            raise RetryLater(timedelta(0), "batch paused")
        if batch.max_cost_usd is not None and batch.cost_usd >= batch.max_cost_usd:
            over = True
        else:
            over = False
            prompts = {
                key: await registry.load_version(session, uuid.UUID(ref["version_id"]))
                for key, ref in (batch.prompt_version_ids or {}).items()
            }
    if over:
        await pause(batch.id, "budget")
        raise RetryLater(timedelta(0), "batch cost cap reached")
    ctx = JudgeCtx(run_id=None, run_case_id=None, batch_id=batch.id, candidate_id=candidate.id)
    return State(batch, candidate, prompts, ctx, job.attempts >= job.max_attempts)


async def pause(batch_id: uuid.UUID, reason: str) -> None:
    async with session_scope() as session:
        await session.execute(
            text(
                "UPDATE synthetic_batches SET status = 'paused', status_reason = :r, "
                "updated_at = now() WHERE id = :b AND status = 'generating'"
            ),
            {"b": batch_id, "r": reason},
        )


def failed(result: JudgeResult, state: State, what: str) -> dict[str, Any]:
    """A non-ok generator reply: retry the job (an `error` isn't reused), or give up on the last
    attempt or a refusal (a refusal is reused, so retrying can't change it)."""
    if result.status == "error" and not state.last_attempt:
        raise RuntimeError(f"{what}: {result.error}")
    return {"generation_error": f"{what}: {result.status} ({result.error})"}


async def call(
    state: State,
    key: str,
    packet: str,
    task_values: dict[str, str] | None = None,
    *,
    model: str | None = None,
    cache_packet: bool = False,
) -> JudgeResult:
    spec = state.prompts.get(key)
    if spec is None:  # a batch created before the prompt existed
        raise RuntimeError(f"Prompt {key} isn't recorded on batch {state.batch.id}")
    return await judge_client.call(
        spec,
        packet,
        spec.render_task(task_values),
        ctx=state.ctx,
        purpose=PURPOSE,
        model=model,
        cache_packet=cache_packet,
    )


def run_tag(batch_id: uuid.UUID) -> str:
    """DocuMind's eval run id for a batch's retrievals (keeps them out of its analytics)."""
    return f"syn_{batch_id.hex}"


async def retrieve(
    state: State, question: str, *, top_k: int, document_ids: Sequence[str] | None = None
) -> list[dict[str, Any]]:
    async with documind_limiter():
        result = await get_documind().retrieve(
            state.batch.org_id,
            question,
            modes=("hybrid",),
            top_k=top_k,
            document_ids=document_ids,
            eval_run_id=run_tag(state.batch.id),
            eval_case_id=f"c{state.candidate.ordinal}",
            request_id=f"eval.syn{state.batch.id.hex[:8]}.c{state.candidate.ordinal}",
        )
    mode = result.results.get("hybrid")
    return [
        {
            "n": n,
            "role": "retrieved",
            "chunk_id": s.chunk_id,
            "document_id": s.document_id,
            "doc_code": s.doc_code,
            "title": s.title,
            "department": s.department,
            "jurisdiction": s.jurisdiction,
            "section_number": s.section_number,
            "section_title": s.section_title,
            "page_start": s.page_start,
            "page_end": s.page_end,
            "content_type": s.content_type,
            "text": s.text or "",
        }
        for n, s in enumerate(mode.sources if mode else [], start=1)
    ]


async def generate(state: State) -> tuple[dict[str, Any], dict[str, Any]]:
    candidate, batch = state.candidate, state.batch
    excerpts = list(candidate.source_excerpt or [])
    if candidate.type in CATALOG_TYPES:
        packet = render_catalog(batch.config.get("catalog") or [])
    else:
        packet = render_chunks(excerpts)
    result = await call(
        state,
        f"gen.{candidate.type}",
        packet,
        dict((candidate.seed or {}).get("hints") or {}),
        model=batch.config.get("generator_model"),
        cache_packet=candidate.type in CATALOG_TYPES,
    )
    if not result.ok:
        return {}, failed(result, state, "generation")
    assert isinstance(result.output, GeneratedCase)
    fields = normalize(candidate.type, result.output, excerpts)
    checks: dict[str, Any] = {"generator_model": result.model_actual}

    sources = excerpts
    if candidate.type == "unanswerable":
        try:
            sources = await retrieve(state, fields["question"], top_k=RETRIEVE_TOP_K)
        except DocuMindError as exc:
            if exc.retryable and not state.last_attempt:
                raise
            checks["retrieval_error"] = str(exc)[:500]
        else:
            fields["source_excerpt"] = sources
            checks["retrieval"] = [
                {"n": s["n"], "section": synthetic_checks.section_key(s["doc_code"],
                                                                     s["section_number"])}
                for s in sources
            ]  # fmt: skip

    if not checks.get("retrieval_error"):
        validation = await call(
            state,
            "gen.validate",
            render_candidate(
                type=candidate.type,
                question=fields["question"],
                expected_behavior=fields["expected_behavior"],
                jurisdiction=fields["expected_jurisdiction"],
                reference_answer=fields["reference_answer"],
                key_facts=fields["key_facts"],
            )
            + "\n"
            + render_chunks(sources),
            model=batch.config.get("validator_model"),
        )
        checks["validation"] = validation_dict(validation)

    texts = [e.get("text") or "" for e in excerpts]
    if candidate.type in synthetic.CHUNK_TYPES:
        checks["overlap"] = synthetic_checks.copy_overlap(fields["question"], texts)
        checks["sections"] = synthetic_checks.check_sections(
            fields["expected_sections"], fields["expected_doc_codes"], excerpts
        )
        checks["has_sections"] = bool(fields["expected_sections"])
        checks["quotes"] = synthetic_checks.check_quotes(fields["evidence_quotes"], texts)
    return fields, checks


async def enrich(state: State) -> tuple[dict[str, Any], dict[str, Any]]:
    candidate, batch = state.candidate, state.batch
    excerpts = list(candidate.source_excerpt or [])
    checks: dict[str, Any] = {}
    fields: dict[str, Any] = {}
    if not excerpts and (candidate.seed or {}).get("retrieve"):
        doc_ids = batch.config.get("doc_ids") or {}
        ids = [doc_ids[c] for c in candidate.expected_doc_codes if c in doc_ids]
        try:
            excerpts = await retrieve(
                state, candidate.question or "", top_k=ENRICH_RETRIEVE_TOP_K, document_ids=ids
            )
        except DocuMindError as exc:
            if exc.retryable and not state.last_attempt:
                raise
            checks["retrieval_error"] = str(exc)[:500]
        fields["source_excerpt"] = excerpts
    checks["chunk_count"] = len(excerpts)
    if (candidate.seed or {}).get("missing_sections"):
        checks["missing_sections"] = candidate.seed["missing_sections"]
    if not excerpts:
        return fields, checks

    result = await call(
        state,
        "gen.enrich_reference",
        render_candidate(
            type=candidate.type,
            question=candidate.question or "",
            jurisdiction=candidate.expected_jurisdiction,
        )
        + "\n"
        + render_chunks(excerpts),
        model=batch.config.get("generator_model"),
    )
    if not result.ok:
        checks.update(failed(result, state, "enrichment"))
        return fields, checks
    assert isinstance(result.output, EnrichedReference)
    out = result.output
    fields.update(
        {
            "reference_answer": out.reference_answer.strip(),
            "key_facts": [{"fact": f.fact.strip(), "weight": float(f.weight)}
                          for f in out.key_facts],
            "evidence_quotes": [q for q in out.evidence_quotes if q.strip()],
            "rationale": out.rationale.strip(),
        }
    )  # fmt: skip
    checks["generator_model"] = result.model_actual
    validation = await call(
        state,
        "gen.validate",
        render_candidate(
            type=candidate.type,
            question=candidate.question or "",
            expected_behavior=candidate.expected_behavior,
            jurisdiction=candidate.expected_jurisdiction,
            reference_answer=fields["reference_answer"],
            key_facts=fields["key_facts"],
        )
        + "\n"
        + render_chunks(excerpts),
        model=batch.config.get("validator_model"),
    )
    checks["validation"] = validation_dict(validation)
    checks["quotes"] = synthetic_checks.check_quotes(
        fields["evidence_quotes"], [e.get("text") or "" for e in excerpts]
    )
    return fields, checks


COUNT_SQL = text(
    """
    UPDATE synthetic_batches
    SET generated_count = generated_count + :generated, failed_count = failed_count + :failed,
        updated_at = now()
    WHERE id = :b
    RETURNING generated_count, failed_count, candidate_count
    """
)


async def save(state: State, fields: dict[str, Any], checks: dict[str, Any]) -> None:
    """Dedupe against the target dataset and the batch's other candidates, then store, under
    the batch's advisory lock so two concurrent candidates can't both pass as originals."""
    batch, candidate = state.batch, state.candidate
    enrichment = batch.kind == "enrichment"
    async with session_scope() as session:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(:k)"), {"k": synthetic.lock_key(batch.id)}
        )
        row = await session.get(SyntheticCandidate, candidate.id, with_for_update=True)
        if row is None or row.gen_status != "queued":
            return
        question = fields.get("question")
        if question and not enrichment:
            others = await session.execute(
                select(SyntheticCandidate.ordinal, SyntheticCandidate.question).where(
                    SyntheticCandidate.batch_id == batch.id,
                    SyntheticCandidate.id != candidate.id,
                    SyntheticCandidate.gen_status == "generated",
                    SyntheticCandidate.status != "rejected",
                )
            )
            pool = [(f"candidate #{o}", q) for o, q in others.all() if q]
            pool += await synthetic.dataset_questions(session, batch.target_dataset_id)
            duplicate = synthetic_checks.nearest(question, pool)
            if duplicate is not None:
                checks["duplicate"] = duplicate.as_dict()
        verdict = synthetic_checks.verdict(
            checks,
            answering=candidate.type in synthetic.CHUNK_TYPES,
            enrichment=enrichment,
        )
        checks["failures"], checks["warnings"] = list(verdict.failures), list(verdict.warnings)
        generation_failed = bool(checks.get("generation_error")) or (
            enrichment and not fields.get("reference_answer")
        )
        for key, value in fields.items():
            setattr(row, key, value)
        row.checks = checks
        row.gen_status = "failed" if generation_failed else "generated"
        row.error = checks.get("generation_error")
        if verdict.rejected:
            row.status, row.auto_rejected, row.reject_reason = "rejected", True, verdict.reason
        counts = (
            await session.execute(
                COUNT_SQL,
                {"b": batch.id, "generated": int(not generation_failed),
                 "failed": int(generation_failed)},
            )
        ).one()  # fmt: skip
        if counts.generated_count + counts.failed_count >= counts.candidate_count:
            await session.execute(
                text(
                    "UPDATE synthetic_batches SET status = 'review', status_reason = NULL, "
                    "finished_at = :t WHERE id = :b"
                ),
                {"b": batch.id, "t": datetime.now(UTC)},
            )
