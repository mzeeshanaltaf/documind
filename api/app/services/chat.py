"""One chat turn: prepare (before streaming) → route → retrieve → synthesize → persist.

`prepare_turn` runs inside the request (so bad conversation/document ids are plain 4xx
responses) and stores the user message. `run_chat` is the SSE generator. It uses its own short
sessions, because the request-scoped session must not be held across a long stream.

A client disconnect stops the stream: sse-starlette cancels its task group (cancelling us
mid-await) or leaves us suspended at a `yield`, which the router's background `aclose()` ends.
Either way the partial answer is saved with `status='stopped'` in a shielded `finally`.

An eval turn (`core/eval.py`) is hidden from users, skips quotas and titles, may carry
`overrides`, and streams richer `routing`/`sources`/`usage` payloads. Normal turns are unchanged.
"""

import asyncio
import contextlib
import dataclasses
import json
import logging
import time
import traceback
import uuid
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import anyio
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import router as router_agent
from app.agents.answer import synthesize
from app.agents.catalog import Catalog, get_org_catalog
from app.agents.citations import extract_citations
from app.agents.router import HistoryTurn, Route
from app.core import request_log
from app.core.db import SessionLocal, session_scope
from app.core.errors import ApiError
from app.core.eval import EvalContext
from app.core.security import Actor
from app.llm import client as llm
from app.llm.usage import UsageCtx
from app.models.chat import Conversation, Message
from app.models.document import Document
from app.rag.hybrid import Mode, RetrievalResult, Source, retrieve
from app.schemas.chat import ChatOverrides, ChatRequest
from app.services import quota
from app.services.org_settings import EffectiveSettings, effective_settings

logger = logging.getLogger(__name__)

HISTORY_MESSAGES = 6
TITLE_MAX_WORDS = 6

# Title tasks outlive their request; keep references so they aren't garbage-collected.
background_tasks: set[asyncio.Task[Any]] = set()


@dataclass
class ChatTurn:
    org_id: str
    user_id: str
    conversation_id: uuid.UUID
    is_new: bool
    user_message_id: uuid.UUID
    assistant_message_id: uuid.UUID
    message: str
    document_ids: list[uuid.UUID] | None
    history: list[HistoryTurn]
    settings: EffectiveSettings
    eval: EvalContext | None = None
    retrieval_mode: Mode = "hybrid"
    include_source_text: bool = True

    def usage_ctx(self, message_id: uuid.UUID | None = None) -> UsageCtx:
        return UsageCtx(
            org_id=self.org_id,
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            message_id=message_id,
            eval_run_id=self.eval.run_id if self.eval else None,
            eval_case_id=self.eval.case_id if self.eval else None,
        )


@dataclass
class UsageTotals:
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    cost_usd: Decimal = Decimal(0)
    rows: list[Any] = field(default_factory=list)

    def add(self, row: Any) -> None:
        if row is None:
            return
        self.rows.append(row)
        self.input_tokens += row.input_tokens or 0
        self.cached_tokens += row.cached_tokens or 0
        self.output_tokens += row.output_tokens or 0
        self.cost_usd += Decimal(row.cost_usd or 0)


def sse(event: str, data: Any) -> dict[str, str]:
    return {"event": event, "data": json.dumps(data, default=str, ensure_ascii=False)}


def usage_by_operation(rows: Iterable[Any]) -> list[dict[str, Any]]:
    """One entry per metered call (`llm_usage` rows), for eval payloads."""
    return [
        {
            "operation": row.operation,
            "model": row.model,
            "tier_requested": row.service_tier_requested,
            "tier_actual": row.service_tier_actual,
            "input_tokens": row.input_tokens or 0,
            "cached_tokens": row.cached_tokens or 0,
            "output_tokens": row.output_tokens or 0,
            "cost_usd": float(row.cost_usd or 0),
            "latency_ms": row.latency_ms,
            "ttft_ms": row.ttft_ms,
        }
        for row in rows
        if row is not None
    ]


def apply_overrides(
    settings: EffectiveSettings, overrides: ChatOverrides | None
) -> EffectiveSettings:
    if overrides is None:
        return settings
    fields = ("top_k", "chat_model", "router_model", "chat_service_tier")
    changes = {name: getattr(overrides, name) for name in fields}
    return dataclasses.replace(
        settings, **{name: value for name, value in changes.items() if value is not None}
    )


# --- before streaming ------------------------------------------------------------------------


async def load_history(session: AsyncSession, conversation_id: uuid.UUID) -> list[HistoryTurn]:
    rows = (
        await session.execute(
            select(Message.role, Message.content)
            .where(Message.conversation_id == conversation_id, Message.content != "")
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(HISTORY_MESSAGES)
        )
    ).all()
    return [HistoryTurn(role=row.role, content=row.content) for row in reversed(rows)]


async def check_documents(
    session: AsyncSession, org_id: str, document_ids: Sequence[uuid.UUID]
) -> None:
    found = set(
        (
            await session.execute(
                select(Document.id).where(
                    Document.org_id == org_id,
                    Document.id.in_(list(document_ids)),
                    Document.indexed_at.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    missing = [str(doc_id) for doc_id in document_ids if doc_id not in found]
    if missing:
        raise ApiError(
            422,
            "unknown_documents",
            "Some documents don't exist in this organization or aren't indexed yet.",
            {"document_ids": missing},
        )


async def prepare_turn(
    session: AsyncSession,
    org_id: str,
    actor: Actor,
    request: ChatRequest,
    eval_ctx: EvalContext | None = None,
) -> ChatTurn:
    """Load (or create) the conversation, check scoped documents, store the user message.
    An eval turn skips the quota and must stay in an eval conversation (and vice versa)."""
    if request.overrides is not None and eval_ctx is None:
        raise ApiError(
            403, "overrides_require_eval", "Overrides need the X-Eval-Run-Id header (admins)."
        )
    if eval_ctx is None:
        await quota.enforce(session, actor)
    document_ids = request.document_ids
    history: list[HistoryTurn] = []
    if request.conversation_id:
        conversation = await session.get(Conversation, request.conversation_id)
        if (
            conversation is None
            or conversation.org_id != org_id
            or conversation.user_id != actor.id
            or conversation.is_eval != (eval_ctx is not None)
        ):
            raise ApiError(404, "not_found", "Conversation not found.")
        if document_ids is None and conversation.scope == "docs" and conversation.document_ids:
            document_ids = list(conversation.document_ids)
        history = await load_history(session, conversation.id)
        is_new = False
    else:
        conversation = Conversation(
            id=uuid.uuid4(),
            org_id=org_id,
            user_id=actor.id,
            scope="docs" if document_ids else "all",
            document_ids=document_ids or [],
        )
        if eval_ctx is not None:
            conversation.is_eval = True
            conversation.eval_run_id = eval_ctx.run_id
            conversation.eval_case_id = eval_ctx.case_id
            conversation.title = f"[eval] {eval_ctx.case_id or eval_ctx.run_id}"
        session.add(conversation)
        is_new = True

    if document_ids:
        await check_documents(session, org_id, document_ids)

    overrides = request.overrides
    settings = apply_overrides(await effective_settings(session, org_id), overrides)
    if is_new:
        await session.flush()  # the message FK needs the conversation row
    else:
        conversation.updated_at = func.now()
    user_message = Message(
        id=uuid.uuid4(), conversation_id=conversation.id, role="user", content=request.message
    )
    session.add(user_message)
    if eval_ctx is None:
        await quota.record_message(session, actor.id)
    await session.commit()

    return ChatTurn(
        org_id=org_id,
        user_id=actor.id,
        conversation_id=conversation.id,
        is_new=is_new,
        user_message_id=user_message.id,
        assistant_message_id=uuid.uuid4(),
        message=request.message,
        document_ids=document_ids,
        history=history,
        settings=settings,
        eval=eval_ctx,
        retrieval_mode=(overrides.retrieval_mode if overrides else None) or "hybrid",
        include_source_text=overrides.include_source_text if overrides else True,
    )


# --- the pipeline ----------------------------------------------------------------------------


def policy_owners(
    catalog: Catalog, departments: list[str], document_ids: list[uuid.UUID] | None
) -> list[str]:
    if not document_ids:
        return catalog.owners_for(departments)
    docs = catalog.by_id()
    return list(
        dict.fromkeys(
            f"{docs[d].doc_code or docs[d].title}: {docs[d].owner}"
            for d in document_ids
            if d in docs and docs[d].owner
        )
    )


def source_preview(source: Source) -> dict[str, Any]:
    return {
        "n": source.n,
        "document_id": str(source.document_id),
        "doc_code": source.doc_code,
        "title": source.title,
        "section_number": source.section_number,
        "section_title": source.section_title,
        "page_start": source.page_start,
        "page_end": source.page_end,
        "jurisdiction": source.jurisdiction,
    }


def routing_payload(turn: ChatTurn, route: Route) -> dict[str, Any]:
    document_ids = [str(d) for d in turn.document_ids or []]
    if turn.eval:
        # A superset: adds needs_clarification, clarifying_question and each part's query.
        return {**route.as_dict(), "document_ids": document_ids}
    return {
        "departments": route.departments,
        "jurisdiction": route.jurisdiction,
        "standalone_query": route.standalone_query,
        "sub_queries": route.sub_queries,
        "parts": [
            {"departments": p.departments, "jurisdiction": p.jurisdiction} for p in route.parts
        ],
        "bypassed": route.bypassed,
        "document_ids": document_ids,
    }


def sources_payload(turn: ChatTurn, sources: Sequence[Source]) -> list[dict[str, Any]]:
    """Users get previews; an eval turn gets every source with chunk id, scores and (unless
    `include_source_text` is off) the chunk text."""
    if not turn.eval:
        return [source_preview(source) for source in sources]
    full = [source.as_dict() for source in sources]
    if not turn.include_source_text:
        for item in full:
            item.pop("text")
    return full


async def save_assistant_message(
    turn: ChatTurn,
    *,
    content: str,
    status: str,
    route: Route | None,
    retrieval: RetrievalResult | None,
    citations: list[dict[str, Any]],
    usage: UsageTotals,
    timings: dict[str, int | None],
) -> None:
    summary = retrieval.summary() if retrieval else {}
    summary["usage"] = {
        "input_tokens": usage.input_tokens,
        "cached_tokens": usage.cached_tokens,
        "output_tokens": usage.output_tokens,
        "cost_usd": float(usage.cost_usd),
    }
    summary["timings_ms"] = {**summary.get("timings_ms", {}), **timings}
    async with session_scope() as session:
        session.add(
            Message(
                id=turn.assistant_message_id,
                conversation_id=turn.conversation_id,
                role="assistant",
                content=content,
                citations=citations,
                sources=[source.as_dict() for source in retrieval.sources] if retrieval else [],
                routing=route.as_dict() if route else None,
                retrieval=summary,
                status=status,
            )
        )
        await session.execute(
            update(Conversation)
            .where(Conversation.id == turn.conversation_id)
            .values(updated_at=func.now())
        )


async def run_chat(turn: ChatTurn) -> AsyncIterator[dict[str, str]]:
    started = time.perf_counter()
    ctx = turn.usage_ctx(turn.assistant_message_id)
    settings = turn.settings
    usage = UsageTotals()
    route: Route | None = None
    retrieval: RetrievalResult | None = None
    sources: list[Source] = []
    content = ""
    ttft_ms: int | None = None
    status = "stopped"  # until proven otherwise (a cancellation never reaches the end)
    saved = False

    def elapsed() -> int:
        return round((time.perf_counter() - started) * 1000)

    request_log.annotate(conversation_id=turn.conversation_id, message_id=turn.assistant_message_id)
    try:
        yield sse(
            "meta",
            {
                "conversation_id": str(turn.conversation_id),
                "user_message_id": str(turn.user_message_id),
                "assistant_message_id": str(turn.assistant_message_id),
            },
        )

        if turn.document_ids:
            route = await router_agent.rewrite_only(
                turn.message,
                turn.history,
                model=settings.router_model,
                tier=settings.chat_service_tier,
                ctx=ctx,
            )
            catalog = await get_org_catalog(turn.org_id)
        else:
            catalog = await get_org_catalog(turn.org_id)
            route = await router_agent.route(
                turn.message,
                turn.history,
                catalog,
                model=settings.router_model,
                tier=settings.chat_service_tier,
                ctx=ctx,
            )
        usage.rows.append(route.usage_row)
        yield sse("routing", routing_payload(turn, route))

        if route.needs_clarification and route.clarifying_question:
            yield sse("sources", [])
            content = route.clarifying_question
            ttft_ms = elapsed()
            yield sse("delta", {"text": content})
        else:
            queries = route.queries
            vectors = await llm.embed(
                queries, operation="embed_query", ctx=ctx, usage_rows=usage.rows
            )
            retrieval = await retrieve(
                turn.org_id,
                route.retrieval_parts(vectors, turn.document_ids),
                top_k=settings.top_k,
                mode=turn.retrieval_mode,
            )
            sources = retrieval.sources
            yield sse("sources", sources_payload(turn, sources))

            stream = synthesize(
                turn.message,
                sources,
                turn.history,
                departments=route.departments,
                owners=policy_owners(catalog, route.departments, turn.document_ids),
                standalone_query=route.standalone_query,
                parts=route.sub_queries,
                jurisdiction=route.jurisdiction,
                model=settings.chat_model,
                tier=settings.chat_service_tier,
                ctx=ctx,
            )
            # aclosing: if we're closed mid-answer, the OpenAI stream closes (and is metered) too.
            async with contextlib.aclosing(aiter(stream)) as deltas:
                async for delta in deltas:
                    if ttft_ms is None:
                        ttft_ms = elapsed()
                    content += delta
                    yield sse("delta", {"text": delta})
            usage.rows.append(stream.usage_row)

        citations = extract_citations(content, sources)
        yield sse("citations", citations)

        status = "complete"
        totals = _recount(usage)
        latency_ms = elapsed()
        await save_assistant_message(
            turn,
            content=content,
            status=status,
            route=route,
            retrieval=retrieval,
            citations=citations,
            usage=totals,
            timings={"total": latency_ms, "ttft": ttft_ms},
        )
        saved = True
        usage_payload: dict[str, Any] = {
            "input_tokens": totals.input_tokens,
            "cached_tokens": totals.cached_tokens,
            "output_tokens": totals.output_tokens,
            "cost_usd": float(totals.cost_usd),
            "latency_ms": latency_ms,
            "ttft_ms": ttft_ms,
        }
        if turn.eval:
            usage_payload["by_operation"] = usage_by_operation(totals.rows)
            usage_payload["retrieval"] = retrieval.summary() if retrieval else None
        yield sse("usage", usage_payload)
        yield sse("done", {})
        if turn.is_new and not turn.eval:
            schedule_title(turn, content)
    except Exception as exc:
        status = "error"
        logger.exception("Chat turn failed (conversation %s)", turn.conversation_id)
        # The response is already a 200 stream; the log row is the only place the cause shows.
        request_log.annotate(
            error_message=f"{type(exc).__name__}: {exc}"[:2000],
            error_traceback=traceback.format_exc()[-request_log.TRACEBACK_CAP :],
        )
        yield sse("error", {"message": _public_error(exc)})
    finally:
        if not saved:
            # Cancelled (client disconnected) or failed: keep what was produced.
            with anyio.CancelScope(shield=True):
                try:
                    await save_assistant_message(
                        turn,
                        content=content,
                        status=status,
                        route=route,
                        retrieval=retrieval,
                        citations=extract_citations(content, sources),
                        usage=_recount(usage),
                        timings={"total": elapsed(), "ttft": ttft_ms},
                    )
                except Exception:
                    logger.exception("Could not save the %s assistant message", status)
            # A first turn that was stopped or failed still names its conversation (mostly
            # from the question), so the history doesn't fill up with untitled chats.
            if turn.is_new and not turn.eval:
                schedule_title(turn, content)


def _recount(usage: UsageTotals) -> UsageTotals:
    totals = UsageTotals()
    for row in usage.rows:
        totals.add(row)
    return totals


def _public_error(exc: BaseException) -> str:
    if isinstance(exc, ApiError):
        return exc.message
    return "Something went wrong while answering. Please try again."


# --- titles ----------------------------------------------------------------------------------

TITLE_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "name": "conversation_title",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
    },
}

TITLE_INSTRUCTIONS = f"""\
Write a short title (at most {TITLE_MAX_WORDS} words) for a conversation that starts with the
user's question below. Plain words, no quotes, no trailing punctuation, no emoji.
"""


def clean_title(value: str) -> str | None:
    words = value.strip().strip("\"'“”").rstrip(".!?").split()
    return " ".join(words[:TITLE_MAX_WORDS]) or None


async def generate_title(turn: ChatTurn, answer: str) -> None:
    try:
        response, _ = await llm.respond(
            model=turn.settings.router_model,
            input=f"Question: {turn.message}\n\nAnswer (start): {answer[:500]}",
            instructions=TITLE_INSTRUCTIONS,
            text_format=TITLE_SCHEMA,
            tier=turn.settings.background_service_tier,
            operation="title",
            ctx=turn.usage_ctx(),
        )
        title = clean_title(json.loads(response.output_text).get("title") or "")
        if not title:
            return
        async with SessionLocal() as session:
            # Don't overwrite a title the user set meanwhile.
            await session.execute(
                update(Conversation)
                .where(Conversation.id == turn.conversation_id, Conversation.title.is_(None))
                .values(title=title)
            )
            await session.commit()
    except Exception:
        logger.exception("Title generation failed for conversation %s", turn.conversation_id)


def schedule_title(turn: ChatTurn, answer: str) -> None:
    task = asyncio.create_task(generate_title(turn, answer), name=f"title-{turn.conversation_id}")
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
