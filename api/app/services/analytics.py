"""Usage and quality analytics over `llm_usage` and `messages` (UTC day/week buckets).

`org_id = None` means every org (platform view). Ranges are [start, end) timestamps.
"""

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

USAGE_SCOPE = """
    u.created_at >= :start AND u.created_at < :end
    AND (CAST(:org AS text) IS NULL OR u.org_id = CAST(:org AS text))
"""
MESSAGE_SCOPE = """
    m.role = 'assistant' AND m.created_at >= :start AND m.created_at < :end
    AND (CAST(:org AS text) IS NULL OR c.org_id = CAST(:org AS text))
"""

TOTALS_SQL = text(
    f"""
    SELECT count(*) FILTER (WHERE u.operation = 'answer') AS requests,
           count(*) AS calls,
           coalesce(sum(u.input_tokens), 0) AS input_tokens,
           coalesce(sum(u.cached_tokens), 0) AS cached_tokens,
           coalesce(sum(u.output_tokens), 0) AS output_tokens,
           coalesce(sum(u.reasoning_tokens), 0) AS reasoning_tokens,
           coalesce(sum(u.cost_usd), 0) AS cost_usd,
           count(*) FILTER (WHERE u.status = 'error') AS errors,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY u.latency_ms)
             FILTER (WHERE u.operation = 'answer' AND u.status = 'ok') AS p50_latency_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY u.latency_ms)
             FILTER (WHERE u.operation = 'answer' AND u.status = 'ok') AS p95_latency_ms,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY u.ttft_ms)
             FILTER (WHERE u.operation = 'answer' AND u.status = 'ok') AS p50_ttft_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY u.ttft_ms)
             FILTER (WHERE u.operation = 'answer' AND u.status = 'ok') AS p95_ttft_ms
    FROM llm_usage u
    WHERE {USAGE_SCOPE}
    """
)

MESSAGES_SQL = text(
    f"""
    SELECT count(*) AS messages,
           count(*) FILTER (WHERE m.feedback = 1) AS up,
           count(*) FILTER (WHERE m.feedback = -1) AS down
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE {MESSAGE_SCOPE}
    """
)

TIMESERIES_SQL = text(
    f"""
    WITH buckets AS (
      SELECT generate_series(
               date_trunc(:granularity, CAST(:start AS timestamptz) AT TIME ZONE 'UTC'),
               (CAST(:end AS timestamptz) AT TIME ZONE 'UTC') - interval '1 microsecond',
               CAST(:step AS interval)) AS bucket
    ),
    usage AS (
      SELECT date_trunc(:granularity, u.created_at AT TIME ZONE 'UTC') AS bucket,
             count(*) FILTER (WHERE u.operation = 'answer') AS requests,
             sum(u.input_tokens) AS input_tokens,
             sum(u.cached_tokens) AS cached_tokens,
             sum(u.output_tokens) AS output_tokens,
             sum(u.cost_usd) AS cost_usd,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY u.latency_ms)
               FILTER (WHERE u.operation = 'answer' AND u.status = 'ok') AS p95_latency_ms
      FROM llm_usage u
      WHERE {USAGE_SCOPE}
      GROUP BY 1
    )
    SELECT b.bucket::date AS date,
           coalesce(x.requests, 0) AS requests,
           coalesce(x.input_tokens, 0) AS input_tokens,
           coalesce(x.cached_tokens, 0) AS cached_tokens,
           coalesce(x.output_tokens, 0) AS output_tokens,
           coalesce(x.cost_usd, 0) AS cost_usd,
           x.p95_latency_ms
    FROM buckets b LEFT JOIN usage x ON x.bucket = b.bucket
    ORDER BY b.bucket
    """
)

BY_OPERATION_SQL = text(
    f"""
    SELECT u.operation, count(*) AS calls,
           sum(u.input_tokens) AS input_tokens, sum(u.cached_tokens) AS cached_tokens,
           sum(u.output_tokens) AS output_tokens, sum(u.cost_usd) AS cost_usd,
           round(avg(u.latency_ms)) AS avg_latency_ms
    FROM llm_usage u WHERE {USAGE_SCOPE}
    GROUP BY 1 ORDER BY cost_usd DESC, calls DESC
    """
)

BY_MODEL_TIER_SQL = text(
    f"""
    SELECT u.model,
           coalesce(u.service_tier_actual, u.service_tier_requested, 'default') AS tier,
           count(*) AS calls,
           sum(u.input_tokens) AS input_tokens, sum(u.cached_tokens) AS cached_tokens,
           sum(u.output_tokens) AS output_tokens, sum(u.cost_usd) AS cost_usd,
           -- `answer` calls alone, so tiers compare like for like (cost per answer)
           count(*) FILTER (WHERE u.operation = 'answer') AS answers,
           coalesce(sum(u.cost_usd) FILTER (WHERE u.operation = 'answer'), 0) AS answer_cost_usd
    FROM llm_usage u WHERE {USAGE_SCOPE}
    GROUP BY 1, 2 ORDER BY cost_usd DESC, calls DESC
    """
)

BY_USER_SQL = text(
    f"""
    SELECT u.user_id, usr.email, usr.name,
           count(*) FILTER (WHERE u.operation = 'answer') AS requests,
           sum(u.input_tokens + u.output_tokens) AS tokens,
           sum(u.cost_usd) AS cost_usd
    FROM llm_usage u LEFT JOIN "user" usr ON usr.id = u.user_id
    WHERE {USAGE_SCOPE} AND u.user_id IS NOT NULL
    GROUP BY 1, 2, 3 ORDER BY cost_usd DESC, requests DESC LIMIT 10
    """
)

BY_AGENT_SQL = text(
    f"""
    WITH cost AS (
      SELECT u.message_id, sum(u.cost_usd) AS cost_usd FROM llm_usage u
      WHERE {USAGE_SCOPE} AND u.message_id IS NOT NULL GROUP BY 1
    )
    SELECT d.agent, count(DISTINCT m.id) AS messages,
           coalesce(sum(cost.cost_usd), 0) AS cost_usd,
           count(*) FILTER (WHERE m.feedback = 1) AS up,
           count(*) FILTER (WHERE m.feedback = -1) AS down
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements_text(m.routing -> 'departments') AS agent
      WHERE jsonb_array_length(coalesce(m.routing -> 'departments', '[]'::jsonb)) > 0
      UNION ALL
      SELECT CASE WHEN m.routing ->> 'bypassed' = 'true' THEN 'Scoped' ELSE 'General' END
      WHERE jsonb_array_length(coalesce(m.routing -> 'departments', '[]'::jsonb)) = 0
    ) d
    LEFT JOIN cost ON cost.message_id = m.id
    WHERE {MESSAGE_SCOPE}
    GROUP BY 1 ORDER BY messages DESC, agent
    """
)

TOP_DOCUMENTS_SQL = text(
    f"""
    SELECT cit ->> 'doc_code' AS doc_code,
           max(cit ->> 'title') AS title,
           max(cit ->> 'document_id') AS document_id,
           count(*) AS citations,
           count(DISTINCT m.id) AS messages
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(m.citations, '[]'::jsonb)) cit
    WHERE {MESSAGE_SCOPE}
    GROUP BY 1 ORDER BY citations DESC, doc_code LIMIT 10
    """
)

ADMIN_ORGS_SQL = text(
    """
    SELECT o.id, o.name, o.slug, o."createdAt" AS created_at,
           (SELECT count(*) FROM documents d WHERE d.org_id = o.id) AS documents,
           (SELECT count(*) FROM member mb WHERE mb."organizationId" = o.id) AS members,
           (SELECT count(*) FROM conversations cv WHERE cv.org_id = o.id) AS conversations,
           (SELECT coalesce(sum(u.cost_usd), 0) FROM llm_usage u
             WHERE u.org_id = o.id AND u.created_at >= now() - interval '30 days')
             AS cost_30d_usd
    FROM organization o
    ORDER BY o.name
    """
)

STEPS = {"day": timedelta(days=1), "week": timedelta(weeks=1)}


def _clean(value: Any) -> Any:
    """Numeric/Decimal/float aggregates → JSON numbers (8 decimals: costs are sub-cent)."""
    if isinstance(value, (Decimal, float)):
        return round(float(value), 8)
    return value


def _rows(result: Any) -> list[dict[str, Any]]:
    return [{key: _clean(value) for key, value in row._mapping.items()} for row in result]


async def analytics(
    session: AsyncSession,
    *,
    org_id: str | None,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> dict[str, Any]:
    params = {"org": org_id, "start": start, "end": end}
    totals = (await session.execute(TOTALS_SQL, params)).one()._mapping
    messages = (await session.execute(MESSAGES_SQL, params)).one()._mapping
    input_tokens = totals["input_tokens"] or 0

    return {
        "range": {"from": start, "to": end, "granularity": granularity, "org_id": org_id},
        "totals": {
            **{key: _clean(value) for key, value in totals.items()},
            "cache_hit_pct": round(100 * totals["cached_tokens"] / input_tokens, 2)
            if input_tokens
            else 0.0,
            "messages": messages["messages"],
        },
        "timeseries": _rows(
            await session.execute(
                TIMESERIES_SQL, {**params, "granularity": granularity, "step": STEPS[granularity]}
            )
        ),
        "by_operation": _rows(await session.execute(BY_OPERATION_SQL, params)),
        "by_model_tier": _rows(await session.execute(BY_MODEL_TIER_SQL, params)),
        "by_user": _rows(await session.execute(BY_USER_SQL, params)),
        "by_agent": _rows(await session.execute(BY_AGENT_SQL, params)),
        "top_documents": _rows(await session.execute(TOP_DOCUMENTS_SQL, params)),
        "feedback": {"up": messages["up"], "down": messages["down"]},
    }


async def admin_orgs(session: AsyncSession) -> list[dict[str, Any]]:
    return _rows(await session.execute(ADMIN_ORGS_SQL))
