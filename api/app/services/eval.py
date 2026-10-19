"""Evaluation-harness endpoints: retrieval without an answer, a document's chunks, the config
fingerprint, and per-run usage and cleanup. Platform admins only (enforced in the router)."""

import dataclasses
import hashlib
import json
import time
import uuid
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import router as router_agent
from app.agents.answer import ANSWER_RULES
from app.agents.catalog import get_org_catalog
from app.agents.router import HistoryTurn
from app.agents.specialists import GENERAL, SPECIALISTS
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.eval import EvalContext
from app.core.security import Actor
from app.llm import client as llm
from app.llm.pricing import chat_models
from app.llm.usage import UsageCtx
from app.models.chat import Conversation
from app.models.document import Chunk, Document
from app.rag import hybrid
from app.schemas.eval import RetrieveRequest
from app.services.analytics import _clean, _rows
from app.services.chat import (
    TITLE_INSTRUCTIONS,
    TITLE_SCHEMA,
    UsageTotals,
    check_documents,
    usage_by_operation,
)
from app.services.org_settings import default_settings, effective_settings

MAX_CHUNKS_PAGE = 500


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


# --- POST /orgs/{org_id}/retrieve ------------------------------------------------------------


async def retrieve_contexts(
    session: AsyncSession,
    org_id: str,
    actor: Actor,
    body: RetrieveRequest,
    eval_ctx: EvalContext | None,
) -> dict[str, Any]:
    """Route once (or only rewrite, when scoped), embed once, then run `retrieve()` per mode,
    the same pattern as `eval/run_eval.py::evaluate_one`. No conversation, no quota."""
    started = time.perf_counter()
    if body.document_ids:
        await check_documents(session, org_id, body.document_ids)
    settings = await effective_settings(session, org_id)
    await session.commit()  # release the connection before the LLM calls
    changes = {
        "top_k": body.top_k,
        "router_model": body.router_model,
        "chat_service_tier": body.chat_service_tier,
    }
    settings = dataclasses.replace(settings, **{k: v for k, v in changes.items() if v is not None})

    ctx = UsageCtx(
        org_id=org_id,
        user_id=actor.id,
        eval_run_id=eval_ctx.run_id if eval_ctx else None,
        eval_case_id=eval_ctx.case_id if eval_ctx else None,
        count_quota=False,
    )
    history = [HistoryTurn(role=item.role, content=item.content) for item in body.history]
    timings: dict[str, int] = {}

    step = time.perf_counter()
    if body.document_ids:
        route = await router_agent.rewrite_only(
            body.query,
            history,
            model=settings.router_model,
            tier=settings.chat_service_tier,
            ctx=ctx,
        )
    else:
        route = await router_agent.route(
            body.query,
            history,
            await get_org_catalog(org_id),
            model=settings.router_model,
            tier=settings.chat_service_tier,
            ctx=ctx,
        )
    timings["route"] = _elapsed_ms(step)
    usage = UsageTotals()
    usage.add(route.usage_row)

    queries = route.queries
    vectors = None
    if any(mode != "bm25" for mode in body.modes):
        step = time.perf_counter()
        rows: list[Any] = []
        vectors = await llm.embed(queries, operation="embed_query", ctx=ctx, usage_rows=rows)
        for row in rows:
            usage.add(row)
        timings["embed"] = _elapsed_ms(step)
    parts = route.retrieval_parts(vectors, body.document_ids)

    results: dict[str, Any] = {}
    for mode in body.modes:  # sequential: each retrieve() already runs 6 searches at once
        step = time.perf_counter()
        result = await hybrid.retrieve(org_id, parts, top_k=settings.top_k, mode=mode)
        timings[f"retrieve_{mode}"] = _elapsed_ms(step)
        results[mode] = {
            "sources": [source.as_dict() for source in result.sources],
            "retrieval": result.summary(),
        }
    timings["total"] = _elapsed_ms(started)

    return {
        "routing": {**route.as_dict(), "document_ids": [str(d) for d in body.document_ids or []]},
        "queries": queries,
        "config": {
            "router_model": settings.router_model,
            "chat_service_tier": settings.chat_service_tier,
            "top_k": settings.top_k,
        },
        "results": results,
        "usage": {
            "input_tokens": usage.input_tokens,
            "cached_tokens": usage.cached_tokens,
            "output_tokens": usage.output_tokens,
            "cost_usd": float(usage.cost_usd),
            "by_operation": usage_by_operation(usage.rows),
        },
        "timings_ms": timings,
    }


# --- GET /orgs/{org_id}/documents/{document_id}/chunks ---------------------------------------


async def document_chunks(
    session: AsyncSession, org_id: str, document_id: uuid.UUID, *, offset: int, limit: int
) -> dict[str, Any]:
    document = await session.get(Document, document_id)
    if document is None or document.org_id != org_id:
        raise ApiError(404, "not_found", "Document not found.")
    total = (
        await session.execute(
            select(func.count()).select_from(Chunk).where(Chunk.document_id == document_id)
        )
    ).scalar_one()
    chunks = (
        (
            await session.execute(
                select(Chunk)
                .where(Chunk.document_id == document_id)
                .order_by(Chunk.chunk_index)
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return {
        "document": {
            "id": str(document.id),
            "doc_code": document.doc_code,
            "title": document.title,
            "department": document.department,
            "jurisdiction": document.jurisdiction,
            "doc_type": document.doc_type,
            "owner": document.owner,
            "page_count": document.page_count,
        },
        "total": total,
        "offset": offset,
        "limit": limit,
        "chunks": [
            {
                "id": str(chunk.id),
                "chunk_index": chunk.chunk_index,
                "text": chunk.text,
                "section_path": list(chunk.section_path or []),
                "section_number": chunk.section_number,
                "section_title": chunk.section_title,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "content_type": chunk.content_type,
                "token_count": chunk.token_count,
            }
            for chunk in chunks
        ],
    }


# --- GET /admin/eval/info --------------------------------------------------------------------


def _sha256(value: Any) -> str:
    data = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
    return hashlib.sha256(data.encode()).hexdigest()


def prompt_hashes() -> dict[str, str]:
    """Fingerprints of the prompts (instructions plus their output schemas), so a run can tell
    whether DocuMind's prompts changed between two runs."""
    specialists = [dataclasses.asdict(s) for s in (*SPECIALISTS.values(), GENERAL)]
    return {
        "router": _sha256(router_agent.ROUTER_INSTRUCTIONS + _sha256(router_agent.ROUTER_SCHEMA)),
        "rewrite": _sha256(
            router_agent.REWRITE_INSTRUCTIONS + _sha256(router_agent.REWRITE_SCHEMA)
        ),
        "answer_rules": _sha256(ANSWER_RULES),
        "specialists": _sha256(specialists),
        "title": _sha256(TITLE_INSTRUCTIONS + _sha256(TITLE_SCHEMA)),
    }


def eval_info() -> dict[str, Any]:
    settings = get_settings()
    return {
        "version": settings.git_sha,
        "defaults": dataclasses.asdict(default_settings()),
        "chat_models": chat_models(),
        "embedding_model": settings.openai_embedding_model,
        "prompt_hashes": prompt_hashes(),
        "retrieval": {
            "RRF_K": hybrid.RRF_K,
            "LIST_K": hybrid.LIST_K,
            "METHOD_WEIGHTS": hybrid.METHOD_WEIGHTS,
            "MIN_FILTERED_HITS": hybrid.MIN_FILTERED_HITS,
            "boosts": {
                "same": hybrid.BOOST_SAME,
                "other_country": hybrid.BOOST_OTHER_COUNTRY,
                "supplement_no_target": hybrid.BOOST_SUPPLEMENT_NO_TARGET,
            },
            "DEFAULT_TOP_K": hybrid.DEFAULT_TOP_K,
            "TOKEN_BUDGET": hybrid.TOKEN_BUDGET,
            "SOURCES_PER_PART": hybrid.SOURCES_PER_PART,
            "TOKENS_PER_PART": hybrid.TOKENS_PER_PART,
            "MAX_SOURCES": hybrid.MAX_SOURCES,
            "MAX_TOKEN_BUDGET": hybrid.MAX_TOKEN_BUDGET,
        },
        "pricing_sha256": hashlib.sha256(settings.pricing_file.read_bytes()).hexdigest(),
    }


# --- /admin/eval-runs/{run_id} ---------------------------------------------------------------

_SUMS = """
    count(*) AS calls,
    coalesce(sum(u.input_tokens), 0) AS input,
    coalesce(sum(u.cached_tokens), 0) AS cached,
    coalesce(sum(u.output_tokens), 0) AS output,
    coalesce(sum(u.cost_usd), 0) AS cost_usd
"""
RUN_TOTALS_SQL = text(
    f"""
    SELECT {_SUMS}, coalesce(sum(u.reasoning_tokens), 0) AS reasoning,
           count(*) FILTER (WHERE u.status <> 'ok') AS errors,
           min(u.created_at) AS first_at, max(u.created_at) AS last_at
    FROM llm_usage u WHERE u.eval_run_id = :run
    """
)
RUN_BY_OPERATION_SQL = text(
    f"""
    SELECT u.operation, u.model, {_SUMS}
    FROM llm_usage u WHERE u.eval_run_id = :run
    GROUP BY 1, 2 ORDER BY cost_usd DESC, 1, 2
    """
)
RUN_BY_CASE_SQL = text(
    f"""
    SELECT u.eval_case_id, {_SUMS}
    FROM llm_usage u WHERE u.eval_run_id = :run
    GROUP BY 1 ORDER BY 1 NULLS FIRST
    """
)


async def run_usage(session: AsyncSession, run_id: str) -> dict[str, Any]:
    params = {"run": run_id}
    totals = (await session.execute(RUN_TOTALS_SQL, params)).one()._mapping
    return {
        "eval_run_id": run_id,
        "totals": {key: _clean(value) for key, value in totals.items()},
        "by_operation": _rows(await session.execute(RUN_BY_OPERATION_SQL, params)),
        "by_case": _rows(await session.execute(RUN_BY_CASE_SQL, params)),
    }


async def run_conversations(
    session: AsyncSession, run_id: str, case_id: str | None = None
) -> list[dict[str, Any]]:
    """The run's eval conversations (optionally one case's), oldest first. The harness uses it
    to find a conversation whose id it never received (a crash between DocuMind creating it and
    the `meta` event being stored), so a retry can't leave a duplicate behind."""
    stmt = (
        select(Conversation.id, Conversation.eval_case_id, Conversation.created_at)
        .where(Conversation.is_eval.is_(True), Conversation.eval_run_id == run_id)
        .order_by(Conversation.created_at, Conversation.id)
    )
    if case_id is not None:
        stmt = stmt.where(Conversation.eval_case_id == case_id)
    return [
        {"id": str(row.id), "eval_case_id": row.eval_case_id, "created_at": row.created_at}
        for row in (await session.execute(stmt)).all()
    ]


async def delete_run_conversations(session: AsyncSession, run_id: str) -> int:
    """Delete the run's eval conversations (messages cascade); usage rows are kept."""
    result = await session.execute(
        delete(Conversation).where(
            Conversation.is_eval.is_(True), Conversation.eval_run_id == run_id
        )
    )
    await session.commit()
    return result.rowcount or 0
