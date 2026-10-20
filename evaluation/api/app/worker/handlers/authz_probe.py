"""`authz_probe`: send an `authz_probe` case's requests to DocuMind as the probe user and record
each status (`services/probes.py`). The `authz_probe` metric is 1 only when every request got
the status it expects.

Placeholders are filled per run: `{org_id}` and `{doc_id}` from the run's snapshot,
`{canary_org_id}` from the service account's org list, and `{bot_conversation_id}` from a
conversation the service account starts (eval-tagged, stopped right after DocuMind announces
it, deleted once the probes are done).

Errors: a missing probe user or canary org fails the case at stage `probe_setup` (permanent).
A transport failure or a 5xx is retried with backoff; on the last attempt the 5xx is recorded
as the probe's outcome (it isn't the expected status, so the probe fails).
"""

import contextlib
import logging
from typing import Any

from app.core.config import get_settings
from app.documind.client import DocuMindClient, DocuMindError, get_documind
from app.documind.events import MetaEvent
from app.schemas.datasets import ProbeRequest
from app.services import canary, run_state
from app.services.case_results import Generated, save_generated
from app.services.probes import (
    ProbeOutcome,
    ProbeSetupError,
    Stopwatch,
    needed_placeholders,
    resolve_body,
    resolve_path,
)
from app.worker.handlers.case_generate import CaseJob, begin
from app.worker.limits import documind_limiter
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)

BOT_MESSAGE = "What is the visitor policy?"


async def handle(job: ClaimedJob) -> None:
    state = await begin(job)
    if state is None:
        return
    last_attempt = job.attempts >= job.max_attempts
    try:
        generated = await run_probes(state, get_documind(), last_attempt=last_attempt)
    except ProbeSetupError as exc:
        await run_state.fail_case(state.run_case.id, "probe_setup", str(exc))
        return
    except DocuMindError as exc:
        if exc.retryable and not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "probe", str(exc))
        return
    except Exception as exc:
        if not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "probe", f"{type(exc).__name__}: {exc}")
        return
    try:
        await save_generated(state.run, state.run_case.id, state.case, generated)
    except Exception as exc:
        if not last_attempt:
            raise
        await run_state.fail_case(state.run_case.id, "score", f"{type(exc).__name__}: {exc}")


def probe_requests(state: CaseJob) -> list[ProbeRequest]:
    requests = [ProbeRequest.model_validate(p) for p in state.case.probes or []]
    if not requests:
        raise ProbeSetupError("The case has no probe requests.")
    return requests


async def canary_org_id(documind: DocuMindClient, state: CaseJob) -> str:
    slug = (state.run.snapshot.get("canary") or {}).get("org_slug")
    if not slug and (current := canary.current()) is not None:
        slug = current.org_slug
    me = await documind.me(**state.tags)
    org = next((o for o in me.orgs if o.slug == slug), None) if slug else None
    if org is None:
        raise ProbeSetupError(
            f"DocuMind has no canary org {slug!r}; run scripts.setup_canary_org first."
        )
    return org.id


async def start_bot_conversation(documind: DocuMindClient, state: CaseJob) -> str:
    """A conversation the service account owns, stopped as soon as DocuMind announces it."""
    stream = documind.chat(
        state.run.org_id,
        BOT_MESSAGE,
        request_id=f"{state.request_id}.bot",
        **state.tags,
    )
    async with contextlib.aclosing(stream) as events:
        async for event in events:
            if isinstance(event, MetaEvent):
                return event.conversation_id
    raise DocuMindError(None, "incomplete_stream", "The chat ended before announcing its id.")


async def resolve_values(
    documind: DocuMindClient, state: CaseJob, needed: set[str]
) -> dict[str, str]:
    values: dict[str, str] = {"org_id": state.run.org_id}
    if "doc_id" in needed:
        ids = (state.run.snapshot.get("documents") or {}).get("ids") or []
        if not ids:
            raise ProbeSetupError("The run's org has no documents for {doc_id}.")
        values["doc_id"] = ids[0]
    if "canary_org_id" in needed:
        values["canary_org_id"] = await canary_org_id(documind, state)
    if "bot_conversation_id" in needed:
        async with documind_limiter():
            values["bot_conversation_id"] = await start_bot_conversation(documind, state)
    return values


async def send(
    client: DocuMindClient,
    state: CaseJob,
    index: int,
    request: ProbeRequest,
    values: dict[str, str],
    *,
    last_attempt: bool,
) -> ProbeOutcome:
    url = resolve_path(request.path, values)
    headers = DocuMindClient.tag_headers(
        **(state.tags if request.eval_headers else {}),
        request_id=f"{state.request_id}.p{index}",
    )
    watch = Stopwatch()
    body = resolve_body(request.body, values) if request.body is not None else None
    status, code = await client.probe(request.method, url, json=body, headers=headers)
    if status >= 500 and not last_attempt:
        raise DocuMindError(status, code or f"http_{status}", f"{request.name}: DocuMind {status}")
    return ProbeOutcome(request, url, status, code, watch.ms())


async def run_probes(
    state: CaseJob, documind: DocuMindClient, *, last_attempt: bool = False
) -> Generated:
    settings = get_settings()
    if not settings.eval_probe_user_id:
        raise ProbeSetupError("EVAL_PROBE_USER_ID is not set; run scripts.bootstrap_service_users.")
    requests = probe_requests(state)
    values = await resolve_values(documind, state, needed_placeholders(requests))
    watch = Stopwatch()
    outcomes: list[ProbeOutcome] = []
    try:
        async with DocuMindClient(user_id=settings.eval_probe_user_id) as probe_client:
            for index, request in enumerate(requests, start=1):
                async with documind_limiter():
                    outcome = await send(
                        probe_client, state, index, request, values, last_attempt=last_attempt
                    )
                outcomes.append(outcome)
    finally:
        if conversation := values.get("bot_conversation_id"):
            with contextlib.suppress(DocuMindError):
                await documind.delete_conversation(conversation, **state.tags)
    results = [o.as_dict() for o in outcomes]
    failed = [r["name"] for r in results if not r["ok"]]
    if failed:
        logger.warning("Case %s: probes failed: %s", state.case.case_key, ", ".join(failed))
    return Generated(
        contexts=_empty_contexts(state),
        latency_ms=watch.ms(),
        probes=results,
        trace={
            "probes": results,
            "values": {k: v for k, v in values.items() if k != "org_id"},
            "probe_user_id": settings.eval_probe_user_id,
        },
    )


def _empty_contexts(state: CaseJob) -> dict[str, list[Any]]:
    """One (empty) entry per scored mode, so the probe metric is stored under each."""
    config = state.run.config
    if state.run.mode == "retrieval_only":
        return {mode: [] for mode in config.get("retrieval_modes") or ["hybrid"]}
    return {(config.get("effective") or {}).get("retrieval_mode") or "hybrid": []}
