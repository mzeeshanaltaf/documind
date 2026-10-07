"""The only door to OpenAI. Every call is timed and metered into `llm_usage`.

Tiers: settings say `standard|flex|auto`, the API says `default|flex|auto`. Flex calls get a long
timeout and no SDK retries; on capacity errors they retry once with jitter, then fall back to
`default` (the usage row then shows requested=flex, actual=default).
"""

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable, Sequence
from functools import lru_cache
from typing import Any

import openai
from openai import AsyncOpenAI

from app.core.config import get_settings
from app.llm.usage import TokenUsage, UsageCtx, record_usage

logger = logging.getLogger(__name__)

FLEX_TIMEOUT_S = 600.0
EMBED_BATCH_SIZE = 100
EMBED_CONCURRENCY = 4

_API_TIERS = {"standard": "default", "default": "default", "flex": "flex", "auto": "auto"}


@lru_cache
def get_client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=get_settings().openai_api_key)


def api_tier(tier: str) -> str:
    """Settings tier (or an API tier) → the value OpenAI's `service_tier` accepts."""
    try:
        return _API_TIERS[tier]
    except KeyError:
        raise ValueError(f"Unknown service tier: {tier!r}") from None


def extract_tokens(usage: Any) -> TokenUsage:
    """Responses API `usage` → our token counts (missing fields count as 0)."""
    if usage is None:
        return TokenUsage()
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    return TokenUsage(
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        cached_tokens=getattr(input_details, "cached_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        reasoning_tokens=getattr(output_details, "reasoning_tokens", 0) or 0,
    )


def is_capacity_error(exc: BaseException) -> bool:
    """429s and "resource unavailable" (flex capacity) are worth a retry/fallback."""
    if isinstance(exc, openai.RateLimitError):
        return True
    if isinstance(exc, openai.APIStatusError):
        return exc.status_code == 503 or "resource unavailable" in str(exc).lower()
    return False


async def _create_response(params: dict[str, Any], tier: str) -> Any:
    client = get_client()
    if tier == "flex":
        client = client.with_options(timeout=FLEX_TIMEOUT_S, max_retries=0)
    return await client.responses.create(**params, service_tier=tier)


async def _create_with_flex_fallback(params: dict[str, Any], tier: str) -> Any:
    if tier != "flex":
        return await _create_response(params, tier)
    for attempt in range(2):
        try:
            return await _create_response(params, "flex")
        except Exception as exc:
            if not is_capacity_error(exc):
                raise
            if attempt == 0:
                await asyncio.sleep(random.uniform(1.0, 4.0))
                continue
            logger.warning("Flex capacity unavailable twice; falling back to default tier")
    return await _create_response(params, "default")


async def respond(
    *,
    model: str,
    input: str | list[dict[str, Any]],
    instructions: str | None = None,
    text_format: dict[str, Any] | None = None,
    tier: str,
    operation: str,
    ctx: UsageCtx,
) -> tuple[Any, Any]:
    """One non-streaming Responses call. `text_format` is the `text.format` object (e.g. a
    strict json_schema). Returns `(response, usage_row)`; errors are metered, then re-raised."""
    requested = api_tier(tier)
    params: dict[str, Any] = {"model": model, "input": input}
    if instructions:
        params["instructions"] = instructions
    if text_format:
        params["text"] = {"format": text_format}

    started = time.perf_counter()
    try:
        response = await _create_with_flex_fallback(params, requested)
    except Exception as exc:
        await record_usage(
            ctx,
            operation=operation,
            model=model,
            tokens=TokenUsage(),
            tier_requested=requested,
            latency_ms=_elapsed_ms(started),
            status="error",
            error=f"{type(exc).__name__}: {exc}",
        )
        raise

    row = await record_usage(
        ctx,
        operation=operation,
        model=model,
        tokens=extract_tokens(response.usage),
        tier_requested=requested,
        tier_actual=getattr(response, "service_tier", None),
        latency_ms=_elapsed_ms(started),
    )
    return response, row


async def embed(
    texts: Sequence[str],
    *,
    operation: str,
    ctx: UsageCtx,
    on_progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> list[list[float]]:
    """Embed texts in batches of ≤ 100 (one usage row per batch); output order matches input."""
    model = get_settings().openai_embedding_model
    batches = [
        list(texts[i : i + EMBED_BATCH_SIZE]) for i in range(0, len(texts), EMBED_BATCH_SIZE)
    ]
    results: list[list[list[float]]] = [[] for _ in batches]
    semaphore = asyncio.Semaphore(EMBED_CONCURRENCY)
    done = 0

    async def run(index: int, batch: list[str]) -> None:
        nonlocal done
        async with semaphore:
            started = time.perf_counter()
            try:
                response = await get_client().embeddings.create(model=model, input=batch)
            except Exception as exc:
                await record_usage(
                    ctx,
                    operation=operation,
                    model=model,
                    tokens=TokenUsage(),
                    latency_ms=_elapsed_ms(started),
                    status="error",
                    error=f"{type(exc).__name__}: {exc}",
                )
                raise
            await record_usage(
                ctx,
                operation=operation,
                model=model,
                tokens=TokenUsage(input_tokens=response.usage.prompt_tokens),
                latency_ms=_elapsed_ms(started),
            )
            ordered = sorted(response.data, key=lambda item: item.index)
            results[index] = [item.embedding for item in ordered]
            done += len(batch)
            if on_progress:
                await on_progress(done, len(texts))

    await asyncio.gather(*(run(i, batch) for i, batch in enumerate(batches)))
    return [vector for batch in results for vector in batch]


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
