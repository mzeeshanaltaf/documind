"""Every Anthropic call goes through `call()`.

- **Request:** `system` = the prompt's static role and rubric (cached), user block 1 = the case
  packet (cached when another call reuses it: N samples, the key-facts pair), user block 2 = the
  short task line.
  Structured output (`output_config.format` from the prompt's schema), a fixed `effort`, and
  thinking per model: Haiku can turn it off, Sonnet/Opus 5.5 can't (`between_tools` / adaptive).
  Sonnet and Opus get server-side `fallbacks: "default"`; Haiku has no fallback.
- **Idempotency:** `request_hash` = sha256 of the whole request + `sample_idx`. A stored `ok` or
  `refusal` call of the same run case with that hash is reused, so a retried job never pays
  twice.
- **Errors:** a 429 (after the SDK's own retries) requeues the job (`RetryLater`); 5xx/connection
  errors raise `JudgeTransientError` (the job retries); an account-level 4xx (401, 403, the
  usage-limit 400) raises `JudgeUnavailable` (the run pauses); any other 4xx is recorded and
  returned as `error`. `stop_reason` is checked before parsing: `refusal` → status `refusal`,
  `max_tokens` → `error`.
- **Metering:** each call writes a `judge_calls` row (tokens incl. cache writes/reads, cost from
  `judge-pricing.json` at the model that served it, latency, stop reason, response) and adds its
  cost to the run case and the run. A run that reaches `max_judge_cost_usd` pauses itself
  (`status_reason = budget`) and the call raises `BudgetExceeded`.
"""

import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from functools import lru_cache
from typing import Any

import anthropic
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text

from app.core.config import get_settings
from app.core.db import session_scope
from app.judge import pricing
from app.judge.pricing import Tokens
from app.judge.registry import PromptSpec
from app.models import JudgeCall
from app.services import run_state
from app.worker.errors import RetryLater
from app.worker.limits import judge_limiter

logger = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"
# Models that take server-side `fallbacks: "default"` (Haiku 5.5 has none).
FALLBACK_MODELS = frozenset(
    {"claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5"}
)
# Models whose thinking can't be disabled: omit `thinking` (adaptive) and steer with effort.
ALWAYS_THINKING = frozenset({"claude-opus-5-5", "claude-fable-5-1", "claude-fable-5"})
DEFAULT_RETRY_AFTER_S = 30.0
CACHE = {"type": "ephemeral"}


class JudgeTransientError(Exception):
    """A 5xx or connection failure that survived the SDK's retries: retry the job."""


class BudgetExceeded(Exception):
    """The run reached its judge budget and paused itself."""


class JudgeUnavailable(Exception):
    """The account can't make any call (bad key, no permission, its spend limit reached): every
    case would fail the same way, so the run pauses (`status_reason = judge_unavailable`)."""


def account_level(exc: anthropic.APIStatusError) -> bool:
    """401/403, or the 400 Anthropic returns once the account's own usage limit is reached."""
    if exc.status_code in (401, 403):
        return True
    return exc.status_code == 400 and "usage limit" in str(exc.message).lower()


class JudgeConfigError(Exception):
    """The judge can't run (no API key, unpriced model)."""


@lru_cache
def get_client() -> anthropic.AsyncAnthropic:
    """The process-wide client (tests patch this)."""
    key = get_settings().anthropic_api_key
    if not key:
        raise JudgeConfigError("ANTHROPIC_API_KEY is not set")
    return anthropic.AsyncAnthropic(api_key=key, max_retries=3)


@dataclass
class JudgeCtx:
    """Where a call's cost goes: a run case, or a synthetic candidate of a batch (E7; the batch's
    `max_cost_usd` caps it like a run's judge budget). `over_budget` flips once a call pushed the
    run (batch) past its budget, so the job's remaining calls stop before spending more."""

    run_id: uuid.UUID | None
    run_case_id: uuid.UUID | None
    over_budget: bool = False
    batch_id: uuid.UUID | None = None
    candidate_id: uuid.UUID | None = None


@dataclass(frozen=True)
class JudgeResult:
    status: str  # ok | refusal | error
    output: BaseModel | None = None
    call_id: uuid.UUID | None = None
    model_actual: str | None = None
    error: str | None = None
    cost_usd: Decimal = Decimal(0)
    reused: bool = False

    @property
    def ok(self) -> bool:
        return self.status == "ok" and self.output is not None


def thinking_param(model: str, thinking: str, effort: str | None) -> dict[str, Any] | None:
    """The prompt's `thinking` for a model that may not support it (a run can override the
    model). None = omit the parameter (adaptive by default)."""
    if thinking == "adaptive" or effort in ("xhigh", "max"):
        return {"type": "adaptive"}
    if model in ALWAYS_THINKING:
        return None
    if model == "claude-sonnet-5-5":
        return {"type": "between_tools"}
    return {"type": "disabled"}


def build_request(
    spec: PromptSpec,
    packet: str,
    task: str,
    *,
    model: str,
    effort: str | None,
    cache_packet: bool = True,
) -> dict[str, Any]:
    """`cache_packet=False` drops the packet's breakpoint: a cache write costs 1.25× input, so
    only a packet that another call will reuse (N samples, the key-facts pair) is worth it."""
    packet_block: dict[str, Any] = {"type": "text", "text": packet}
    if cache_packet:
        packet_block["cache_control"] = CACHE
    output_config: dict[str, Any] = {
        "format": {"type": "json_schema", "schema": spec.output_schema}
    }
    if effort:
        output_config["effort"] = effort
    request: dict[str, Any] = {
        "model": model,
        "max_tokens": spec.max_tokens,
        "system": [{"type": "text", "text": spec.system, "cache_control": CACHE}],
        "messages": [
            {
                "role": "user",
                "content": [packet_block, {"type": "text", "text": task}],
            }
        ],
        "output_config": output_config,
    }
    thinking = thinking_param(model, spec.thinking, effort)
    if thinking is not None:
        request["thinking"] = thinking
    if model in FALLBACK_MODELS:
        request["fallbacks"] = "default"
        request["betas"] = [FALLBACK_BETA]
    return request


def request_hash(request: dict[str, Any], sample_idx: int) -> str:
    payload = json.dumps(
        {"request": request, "sample_idx": sample_idx},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def priced_model(model: str | None, fallback: str) -> str:
    """The pricing entry for a reported model id: exact, else the longest priced prefix
    (a dated id), else the requested model."""
    if model and pricing.known(model):
        return model
    if model:
        prefixes = [key for key in pricing.pricing() if model.startswith(f"{key}-")]
        if prefixes:
            return max(prefixes, key=len)
        logger.warning("No judge pricing for %s; pricing it as %s", model, fallback)
    return fallback


def _tokens(usage: Any) -> Tokens:
    write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
    split = getattr(usage, "cache_creation", None)
    write_1h = int(getattr(split, "ephemeral_1h_input_tokens", 0) or 0) if split else 0
    return Tokens(
        input=int(usage.input_tokens or 0),
        output=int(usage.output_tokens or 0),
        cache_write_5m=max(write - write_1h, 0),
        cache_write_1h=write_1h,
        cache_read=int(getattr(usage, "cache_read_input_tokens", 0) or 0),
    )


def meter(response: Any, requested: str) -> tuple[Tokens, Decimal]:
    """Tokens and cost of a response. With a server-side fallback, `usage.iterations` lists each
    attempt (the declined one at the requested model, the serving one at the fallback model)."""
    usage = response.usage
    iterations = [
        item
        for item in (getattr(usage, "iterations", None) or [])
        if item.type in ("message", "fallback_message")
    ]
    if not iterations:
        tokens = _tokens(usage)
        return tokens, pricing.cost_usd(priced_model(response.model, requested), tokens)
    total, cost = Tokens(), Decimal(0)
    for item in iterations:
        tokens = _tokens(item)
        total += tokens
        cost += pricing.cost_usd(priced_model(getattr(item, "model", None), requested), tokens)
    return total, cost


def response_text(response: Any) -> str:
    """The text after the last `fallback` block (a declined attempt's partial output comes
    before it); thinking blocks are skipped."""
    blocks = list(response.content or [])
    last_fallback = max((i for i, b in enumerate(blocks) if b.type == "fallback"), default=-1)
    return "".join(b.text for b in blocks[last_fallback + 1 :] if b.type == "text")


def interpret(
    response: Any, output_model: type[BaseModel]
) -> tuple[str, BaseModel | None, str | None]:
    """(status, parsed output, error), checking `stop_reason` before parsing."""
    if response.stop_reason == "refusal":
        details = getattr(response, "stop_details", None)
        category = getattr(details, "category", None) if details else None
        return "refusal", None, f"refusal ({category or 'no category'})"
    if response.stop_reason == "max_tokens":
        return "error", None, "max_tokens: the output was cut off"
    try:
        return "ok", output_model.model_validate_json(response_text(response)), None
    except ValidationError as exc:
        return "error", None, f"invalid_output: {exc.errors()[:3]}"


def _retry_after(exc: anthropic.APIStatusError) -> timedelta:
    try:
        seconds = float(exc.response.headers.get("retry-after") or DEFAULT_RETRY_AFTER_S)
    except ValueError:
        seconds = DEFAULT_RETRY_AFTER_S
    return timedelta(seconds=max(1.0, seconds))


async def _previous(ctx: JudgeCtx, digest: str) -> JudgeCall | None:
    if ctx.run_case_id is not None:
        owner = JudgeCall.run_case_id == ctx.run_case_id
    elif ctx.candidate_id is not None:
        owner = JudgeCall.candidate_id == ctx.candidate_id
    else:
        return None
    async with session_scope() as session:
        return await session.scalar(
            select(JudgeCall)
            .where(
                owner,
                JudgeCall.request_hash == digest,
                JudgeCall.status.in_(("ok", "refusal")),
            )
            .order_by(JudgeCall.created_at.desc())
            .limit(1)
        )


def _reuse(row: JudgeCall, output_model: type[BaseModel]) -> JudgeResult:
    output = None
    if row.status == "ok" and row.response and row.response.get("output") is not None:
        output = output_model.model_validate(row.response["output"])
    return JudgeResult(
        status=row.status if row.status != "ok" or output is not None else "error",
        output=output,
        call_id=row.id,
        model_actual=row.model_actual,
        error=row.error,
        reused=True,
    )


ADD_COST_SQL = text(
    """
    WITH rc AS (
        UPDATE run_cases SET judge_cost_usd = judge_cost_usd + CAST(:cost AS numeric)
        WHERE id = :run_case_id
    )
    UPDATE runs SET judge_cost_usd = judge_cost_usd + CAST(:cost AS numeric), updated_at = now()
    WHERE id = :run_id
    RETURNING judge_cost_usd, max_judge_cost_usd
    """
)


ADD_BATCH_COST_SQL = text(
    """
    WITH c AS (
        UPDATE synthetic_candidates SET cost_usd = cost_usd + CAST(:cost AS numeric)
        WHERE id = :candidate_id
    )
    UPDATE synthetic_batches
    SET cost_usd = cost_usd + CAST(:cost AS numeric), updated_at = now()
    WHERE id = :batch_id
    RETURNING cost_usd, max_cost_usd
    """
)
PAUSE_BATCH_SQL = text(
    """
    UPDATE synthetic_batches SET status = 'paused', status_reason = 'budget', updated_at = now()
    WHERE id = :batch_id AND status = 'generating'
    """
)


async def _record(call: JudgeCall, ctx: JudgeCtx) -> bool:
    """Store the call and add its cost. Returns True when the run (batch) is now over its budget
    (it has then been paused)."""
    async with session_scope() as session:
        session.add(call)
        await session.flush()
        if ctx.batch_id is not None and call.cost_usd:
            row = (
                await session.execute(
                    ADD_BATCH_COST_SQL,
                    {
                        "cost": call.cost_usd,
                        "candidate_id": ctx.candidate_id,
                        "batch_id": ctx.batch_id,
                    },
                )
            ).one_or_none()
            if row is None or row.max_cost_usd is None or row.cost_usd < row.max_cost_usd:
                return False
            await session.execute(PAUSE_BATCH_SQL, {"batch_id": ctx.batch_id})
            return True
        if ctx.run_id is None or not call.cost_usd:
            return False
        row = (
            await session.execute(
                ADD_COST_SQL,
                {"cost": call.cost_usd, "run_case_id": ctx.run_case_id, "run_id": ctx.run_id},
            )
        ).one_or_none()
        if row is None or row.max_judge_cost_usd is None:
            return False
        if row.judge_cost_usd < row.max_judge_cost_usd:
            return False
        await run_state.pause_for_budget(session, ctx.run_id)
        return True


async def call(
    spec: PromptSpec,
    packet: str,
    task: str,
    *,
    ctx: JudgeCtx,
    purpose: str | None = None,
    sample_idx: int = 0,
    model: str | None = None,
    effort: str | None = None,
    cache_packet: bool = False,
) -> JudgeResult:
    model = model or spec.model
    effort = effort or spec.effort
    if not pricing.known(model):
        raise JudgeConfigError(f"Model {model!r} has no entry in judge-pricing.json")
    request = build_request(
        spec, packet, task, model=model, effort=effort, cache_packet=cache_packet
    )
    digest = request_hash(request, sample_idx)
    previous = await _previous(ctx, digest)
    if previous is not None:
        return _reuse(previous, spec.output_model)
    if ctx.over_budget:
        raise BudgetExceeded("the run is over its judge budget")

    row = JudgeCall(
        id=uuid.uuid4(),
        run_id=ctx.run_id,
        run_case_id=ctx.run_case_id,
        batch_id=ctx.batch_id,
        candidate_id=ctx.candidate_id,
        purpose=purpose or spec.key,
        prompt_version_id=spec.version_id,
        model=model,
        effort=effort,
        sample_idx=sample_idx,
        request_hash=digest,
    )
    started = time.perf_counter()
    async with judge_limiter().slot(model):
        try:
            response = await get_client().beta.messages.create(**request)
        except anthropic.RateLimitError as exc:
            raise RetryLater(_retry_after(exc), "Anthropic rate limit") from exc
        except anthropic.APIConnectionError as exc:  # includes timeouts
            raise JudgeTransientError(f"{type(exc).__name__}: {exc}") from exc
        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500:
                raise JudgeTransientError(f"{exc.status_code}: {exc.message}") from exc
            row.status, row.error = "error", f"{exc.status_code}: {exc.message}"[:4000]
            row.latency_ms = round((time.perf_counter() - started) * 1000)
            await _record(row, ctx)
            if account_level(exc):
                raise JudgeUnavailable(row.error) from exc
            return JudgeResult(status="error", call_id=row.id, error=row.error)
    row.latency_ms = round((time.perf_counter() - started) * 1000)

    status, output, error = interpret(response, spec.output_model)
    tokens, cost = meter(response, model)
    row.model_actual = response.model
    row.input_tokens, row.output_tokens = tokens.input, tokens.output
    row.cache_write_tokens, row.cache_read_tokens = tokens.cache_write, tokens.cache_read
    row.cost_usd = cost
    row.stop_reason = response.stop_reason
    row.status, row.error = status, error
    stop_details = getattr(response, "stop_details", None)
    row.response = {
        "id": response.id,
        "model": response.model,
        "stop_reason": response.stop_reason,
        "stop_details": stop_details.model_dump(mode="json") if stop_details else None,
        "output": output.model_dump(mode="json") if output is not None else None,
        "text": None if output is not None else response_text(response)[:20000],
        "usage": response.usage.model_dump(mode="json", exclude_none=True),
    }
    if await _record(row, ctx):
        ctx.over_budget = True
        raise BudgetExceeded("the run reached its judge budget")
    return JudgeResult(
        status=status,
        output=output,
        call_id=row.id,
        model_actual=response.model,
        error=error,
        cost_usd=cost,
    )
