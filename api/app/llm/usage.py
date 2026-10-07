"""`llm_usage` rows: one per OpenAI call, written in their own short session."""

import logging
import uuid
from dataclasses import dataclass

from app.core.db import session_scope
from app.llm.pricing import cost
from app.models.usage import LlmUsage

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class UsageCtx:
    """Who/what a call is for; copied onto its usage row."""

    org_id: str | None
    user_id: str | None = None
    conversation_id: uuid.UUID | None = None
    message_id: uuid.UUID | None = None
    document_id: uuid.UUID | None = None


@dataclass
class TokenUsage:
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0


async def record_usage(
    ctx: UsageCtx,
    *,
    operation: str,
    model: str,
    tokens: TokenUsage,
    tier_requested: str | None = None,
    tier_actual: str | None = None,
    latency_ms: int | None = None,
    ttft_ms: int | None = None,
    status: str = "ok",
    error: str | None = None,
) -> LlmUsage:
    """Insert one usage row, priced at the *actual* tier. Never raises: metering must not break
    the caller (its own transaction is untouched because this uses a separate session)."""
    price = cost(
        model,
        tier_actual or tier_requested,
        tokens.input_tokens,
        tokens.cached_tokens,
        tokens.output_tokens,
    )
    row = LlmUsage(
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        conversation_id=ctx.conversation_id,
        message_id=ctx.message_id,
        document_id=ctx.document_id,
        operation=operation,
        model=model,
        service_tier_requested=tier_requested,
        service_tier_actual=tier_actual,
        input_tokens=tokens.input_tokens,
        cached_tokens=tokens.cached_tokens,
        output_tokens=tokens.output_tokens,
        reasoning_tokens=tokens.reasoning_tokens,
        latency_ms=latency_ms,
        ttft_ms=ttft_ms,
        cost_usd=price.usd,
        pricing_estimated=price.estimated,
        status=status,
        error=error[:2000] if error else None,
    )
    try:
        async with session_scope() as session:
            session.add(row)
    except Exception:
        logger.exception("Failed to record llm_usage for %s/%s", operation, model)
    return row
