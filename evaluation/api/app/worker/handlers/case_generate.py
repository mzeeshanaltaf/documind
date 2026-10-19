"""`case_generate`: call DocuMind for one run case, store what it produced, score it.

- **Full:** each `setup_turns` message is sent first in one conversation (their answers go into
  the trace), then the scored question, all with the run's `overrides` and the case's
  `document_ids`. The conversation id is saved as soon as DocuMind announces it (`meta`).
- **Retrieval-only:** one `POST /retrieve` with every requested mode; setup turns become user
  history.

Chat isn't idempotent, so a retry first looks for an earlier attempt's conversations (the
stored `conversation_id`, plus DocuMind's list for this case on attempts > 1): one with a
complete scored answer is rebuilt from; every other one is deleted and the case starts over.

Errors: a DocuMind 4xx other than 429 is permanent (the case becomes `error`, the run goes on).
429, 5xx, timeouts and stream errors are retried with backoff; on the last attempt the case
becomes `error`. A paused run's job goes back to the queue untouched.
"""

import contextlib
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import select, update

from app.core.db import session_scope
from app.documind.client import DocuMindClient, DocuMindError, get_documind
from app.documind.events import (
    CitationsEvent,
    DeltaEvent,
    DoneEvent,
    ErrorEvent,
    MetaEvent,
    RoutingEvent,
    SourcesEvent,
    UsageEvent,
)
from app.models import Case, Run, RunCase
from app.services import run_state
from app.services.case_results import Generated, save_generated
from app.services.runs import document_ids_for
from app.worker.errors import RetryLater
from app.worker.limits import documind_limiter
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CaseJob:
    run: Run
    run_case: RunCase
    case: Case
    attempt: int

    @property
    def tags(self) -> dict[str, str]:
        return {"eval_run_id": str(self.run.id), "eval_case_id": str(self.run_case.id)}

    @property
    def request_id(self) -> str:
        """`eval.<run8>.<case_key>.<attempt>` (DocuMind allows `[A-Za-z0-9._-]`, no colons)."""
        return f"eval.{self.run.id.hex[:8]}.{self.case.case_key}.{self.attempt}"


async def handle(job: ClaimedJob) -> None:
    state = await begin(job)
    if state is None:
        return
    last_attempt = job.attempts >= job.max_attempts
    try:
        generated = await generate(state, get_documind())
    except DocuMindError as exc:
        if exc.retryable and not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "generate", str(exc))
        return
    except Exception as exc:
        if not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "generate", f"{type(exc).__name__}: {exc}")
        return
    try:
        await save_generated(state.run, state.run_case.id, state.case, generated)
    except Exception as exc:
        if not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "score", f"{type(exc).__name__}: {exc}")


async def begin(job: ClaimedJob) -> CaseJob | None:
    """Mark the case `generating`, unless the run says otherwise. The run row is read FOR SHARE,
    so a concurrent pause either sees this case in flight or this job sees the pause."""
    async with session_scope() as session:
        run = (
            await session.execute(
                select(Run).where(Run.id == job.run_id).with_for_update(read=True)
            )
        ).scalar_one_or_none()
        run_case = await session.get(RunCase, job.run_case_id) if job.run_case_id else None
        if run is None or run_case is None or run_case.status in run_state.CASE_TERMINAL:
            return None
        if run.status in ("pausing", "paused"):
            raise RetryLater(timedelta(0), "run paused")
        if run.status not in ("running", "stopping"):
            return None
        case = await session.get(Case, run_case.case_id)
        if case is None:
            return None
        run_case.status = "generating"
        run_case.attempt = job.attempts
    return CaseJob(run=run, run_case=run_case, case=case, attempt=job.attempts)


async def generate(state: CaseJob, documind: DocuMindClient) -> Generated:
    if state.run.mode == "retrieval_only":
        return await generate_retrieval(state, documind)
    return await generate_full(state, documind)


# --- retrieval-only --------------------------------------------------------------------------


async def generate_retrieval(state: CaseJob, documind: DocuMindClient) -> Generated:
    config = state.run.config
    overrides = config.get("overrides") or {}
    modes = config.get("retrieval_modes") or ["bm25", "vector", "hybrid"]
    async with documind_limiter():
        result = await documind.retrieve(
            state.run.org_id,
            state.case.question,
            modes=modes,
            history=[{"role": "user", "content": turn} for turn in state.case.setup_turns or []],
            document_ids=document_ids_for(state.run, state.case) or None,
            top_k=overrides.get("top_k"),
            router_model=overrides.get("router_model"),
            chat_service_tier=overrides.get("chat_service_tier"),
            request_id=state.request_id,
            **state.tags,
        )
    usage = result.usage
    routing = result.routing.model_dump(mode="json")
    return Generated(
        answer=None,
        routing=routing,
        needs_clarification=result.routing.needs_clarification,
        contexts={
            mode: [s.model_dump(mode="json") for s in result.results[mode].sources]
            for mode in modes
            if mode in result.results
        },
        top_k=int(result.config.get("top_k") or _effective_top_k(state.run)),
        latency_ms=result.timings_ms.get("total"),
        input_tokens=usage.input_tokens,
        cached_tokens=usage.cached_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=usage.cost_usd,
        usage={
            "by_operation": [op.model_dump(mode="json") for op in usage.by_operation],
            "retrieval": {
                mode: res.retrieval.model_dump(mode="json") for mode, res in result.results.items()
            },
        },
        trace={
            "request_id": state.request_id,
            "queries": result.queries,
            "config": result.config,
            "timings_ms": result.timings_ms,
        },
    )


def _effective_top_k(run: Run) -> int:
    return int((run.config.get("effective") or {}).get("top_k") or 8)


# --- full ------------------------------------------------------------------------------------


@dataclass
class Turn:
    """One streamed chat turn."""

    request_id: str
    message: str
    conversation_id: str | None = None
    assistant_message_id: str | None = None
    routing: dict[str, Any] | None = None
    sources: list[dict[str, Any]] | None = None
    answer: str = ""
    citations: list[dict[str, Any]] | None = None
    usage: UsageEvent | None = None
    events: list[dict[str, Any]] | None = None
    first_delta_ms: int | None = None
    total_ms: int | None = None

    def trace(self, *, scored: bool) -> dict[str, Any]:
        entry = {
            "kind": "scored" if scored else "setup",
            "request_id": self.request_id,
            "message": self.message,
            "assistant_message_id": self.assistant_message_id,
            "events": self.events or [],
            "client_ms": {"first_delta": self.first_delta_ms, "total": self.total_ms},
        }
        if not scored:
            entry["answer"] = self.answer
        return entry


def _compact_source(source: dict[str, Any]) -> dict[str, Any]:
    """Sources in the trace without their text (the contexts table has it)."""
    return {key: value for key, value in source.items() if key != "text"}


async def stream_turn(
    documind: DocuMindClient,
    state: CaseJob,
    message: str,
    *,
    request_id: str,
    conversation_id: str | None,
    on_meta: Callable[[str], Awaitable[None]],
) -> Turn:
    overrides = (state.run.config.get("overrides") or {}) or None
    turn = Turn(request_id=request_id, message=message, events=[])
    started = time.perf_counter()

    def elapsed() -> int:
        return round((time.perf_counter() - started) * 1000)

    done = False
    stream = documind.chat(
        state.run.org_id,
        message,
        conversation_id=conversation_id,
        document_ids=document_ids_for(state.run, state.case) or None,
        overrides=overrides,
        request_id=request_id,
        **state.tags,
    )
    async with contextlib.aclosing(stream) as events:
        async for event in events:
            if isinstance(event, DeltaEvent):
                if turn.first_delta_ms is None:
                    turn.first_delta_ms = elapsed()
                turn.answer += event.text
                continue
            data = event.model_dump(mode="json", exclude={"event"})
            match event:
                case MetaEvent():
                    turn.conversation_id = event.conversation_id
                    turn.assistant_message_id = event.assistant_message_id
                    await on_meta(event.conversation_id)
                case RoutingEvent():
                    turn.routing = event.routing.model_dump(mode="json")
                case SourcesEvent():
                    turn.sources = [s.model_dump(mode="json") for s in event.sources]
                    data = {"sources": [_compact_source(s) for s in turn.sources]}
                case CitationsEvent():
                    turn.citations = [c.model_dump(mode="json") for c in event.citations]
                case UsageEvent():
                    turn.usage = event
                case ErrorEvent():
                    raise DocuMindError(500, "stream_error", event.message)
                case DoneEvent():
                    done = True
            turn.events.append({"event": type(event).__name__, "t_ms": elapsed(), "data": data})
    turn.total_ms = elapsed()
    if not done or turn.conversation_id is None:
        raise DocuMindError(None, "incomplete_stream", "The chat stream ended before `done`.")
    return turn


async def _save_conversation_id(run_case_id: uuid.UUID, conversation_id: str | None) -> None:
    async with session_scope() as session:
        await session.execute(
            update(RunCase)
            .where(RunCase.id == run_case_id)
            .values(conversation_id=uuid.UUID(conversation_id) if conversation_id else None)
        )


async def leftover_conversations(state: CaseJob, documind: DocuMindClient) -> list[str]:
    """Conversations an earlier attempt may have left: the stored id, plus, on a retry, every
    one DocuMind holds for this case (a crash can land after DocuMind created a conversation
    but before its `meta` event was stored here)."""
    ids = [str(state.run_case.conversation_id)] if state.run_case.conversation_id else []
    if state.attempt > 1:
        try:
            listed = await documind.run_conversations(
                str(state.run.id), str(state.run_case.id), **state.tags
            )
        except DocuMindError as exc:
            if exc.status_code != 404:
                raise
            # A DocuMind without the list hook: fall back to the stored id (finalize's cleanup
            # still removes any orphan).
            logger.warning("DocuMind has no eval conversation list; using the stored id only")
            listed = []
        ids += [c["id"] for c in listed if c["id"] not in ids]
    return ids


async def generate_full(state: CaseJob, documind: DocuMindClient) -> Generated:
    leftovers = await leftover_conversations(state, documind)
    recovered: Generated | None = None
    for conversation_id in leftovers:
        if recovered is None:
            recovered = await recover(state, documind, conversation_id)
            if recovered is not None:
                if conversation_id != str(state.run_case.conversation_id):
                    await _save_conversation_id(state.run_case.id, conversation_id)
                continue
        await documind.delete_conversation(conversation_id, **state.tags)
    if recovered is not None:
        return recovered
    if state.run_case.conversation_id is not None:
        await _save_conversation_id(state.run_case.id, None)

    messages = [*(state.case.setup_turns or []), state.case.question]
    conversation_id: str | None = None
    turns: list[Turn] = []

    async def on_meta(new_id: str) -> None:
        nonlocal conversation_id
        if conversation_id is None:
            conversation_id = new_id
            await _save_conversation_id(state.run_case.id, new_id)

    for index, message in enumerate(messages):
        scored = index == len(messages) - 1
        request_id = state.request_id if scored else f"{state.request_id}.t{index + 1}"
        async with documind_limiter():
            turns.append(
                await stream_turn(
                    documind,
                    state,
                    message,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    on_meta=on_meta,
                )
            )
    return _from_turns(state, turns, conversation_id)


def _sum(values: list[int | None]) -> int | None:
    known = [v for v in values if v is not None]
    return sum(known) if known else None


def _from_turns(state: CaseJob, turns: list[Turn], conversation_id: str | None) -> Generated:
    scored = turns[-1]
    usages = [t.usage for t in turns if t.usage is not None]
    routing = scored.routing or {}
    usage = scored.usage
    by_operation = [
        {"turn": index, **op.model_dump(mode="json")}
        for index, turn in enumerate(turns)
        if turn.usage is not None
        for op in turn.usage.by_operation
    ]
    return Generated(
        answer=scored.answer,
        routing=scored.routing,
        citations=scored.citations or [],
        needs_clarification=bool(routing.get("needs_clarification")),
        contexts={_retrieval_mode(state.run): scored.sources or []},
        top_k=_effective_top_k(state.run),
        latency_ms=usage.latency_ms if usage and usage.latency_ms is not None else scored.total_ms,
        ttft_ms=usage.ttft_ms if usage and usage.ttft_ms is not None else scored.first_delta_ms,
        input_tokens=_sum([u.input_tokens for u in usages]),
        cached_tokens=_sum([u.cached_tokens for u in usages]),
        output_tokens=_sum([u.output_tokens for u in usages]),
        cost_usd=sum(u.cost_usd for u in usages),
        usage={
            "by_operation": by_operation,
            "retrieval": (
                usage.retrieval.model_dump(mode="json") if usage and usage.retrieval else None
            ),
            "turns": [
                {
                    "request_id": t.request_id,
                    **(
                        t.usage.model_dump(
                            mode="json", exclude={"event", "by_operation", "retrieval"}
                        )
                        if t.usage
                        else {}
                    ),
                }
                for t in turns
            ],
        },
        trace={
            "conversation_id": conversation_id,
            "recovered": False,
            "turns": [t.trace(scored=i == len(turns) - 1) for i, t in enumerate(turns)],
        },
    )


def _retrieval_mode(run: Run) -> str:
    return (run.config.get("effective") or {}).get("retrieval_mode") or "hybrid"


async def recover(
    state: CaseJob, documind: DocuMindClient, conversation_id: str
) -> Generated | None:
    """Rebuild the outcome from an earlier attempt's conversation when its scored answer is
    complete and every turn matches the case; None means "delete it and start over"."""
    try:
        conversation = await documind.conversation(conversation_id, **state.tags)
    except DocuMindError as exc:
        if exc.status_code == 404:
            return None
        raise
    messages = conversation.get("messages") or []
    users = [m for m in messages if m.get("role") == "user"]
    assistants = [m for m in messages if m.get("role") == "assistant"]
    expected = [*(state.case.setup_turns or []), state.case.question]
    if (
        [m.get("content") for m in users] != expected
        or len(assistants) != len(users)
        or any(m.get("status") != "complete" for m in assistants)
    ):
        logger.info(
            "Case %s: conversation %s is incomplete; restarting", state.run_case.id, conversation_id
        )
        return None
    last = assistants[-1]
    usage = last.get("usage") or {}
    routing = last.get("routing") or {}
    logger.info(
        "Case %s: recovered the answer from conversation %s", state.run_case.id, conversation_id
    )
    return Generated(
        answer=last.get("content") or "",
        routing=routing or None,
        citations=last.get("citations") or [],
        needs_clarification=bool(routing.get("needs_clarification")),
        contexts={_retrieval_mode(state.run): last.get("sources") or []},
        top_k=_effective_top_k(state.run),
        latency_ms=usage.get("latency_ms"),
        ttft_ms=usage.get("ttft_ms"),
        cost_usd=sum(float((m.get("usage") or {}).get("cost_usd") or 0) for m in assistants),
        usage={"recovered": True},
        trace={
            "conversation_id": str(conversation_id),
            "recovered": True,
            "turns": [
                {
                    "kind": "scored" if i == len(users) - 1 else "setup",
                    "message": user.get("content"),
                    "assistant_message_id": assistant.get("id"),
                    **({} if i == len(users) - 1 else {"answer": assistant.get("content")}),
                }
                for i, (user, assistant) in enumerate(zip(users, assistants, strict=True))
            ],
        },
    )
