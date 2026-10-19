"""One user's own activity in one org: conversations, questions, tokens, ratings, response times.

Same UTC buckets and [start, end) ranges as the platform analytics. Response time is what the
person waited for: `messages.retrieval.timings_ms` (routing + retrieval + answer), saved with
each answer. No costs here: those are for platform admins.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.analytics import STEPS, _clean, _rows

# `msg` = this user's messages in range, with the stored timings pulled out.
MESSAGES_CTE = """
    msg AS (
      SELECT m.role, m.status, m.feedback, m.created_at,
             CAST(m.retrieval -> 'timings_ms' ->> 'total' AS float8) AS latency_ms,
             CAST(m.retrieval -> 'timings_ms' ->> 'ttft' AS float8) AS ttft_ms
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.org_id = :org AND c.user_id = :user AND NOT c.is_eval
        AND m.created_at >= :start AND m.created_at < :end
    )
"""
USAGE_SCOPE = """
    u.org_id = :org AND u.user_id = :user AND u.created_at >= :start AND u.created_at < :end
    AND u.eval_run_id IS NULL
"""

TOTALS_SQL = text(
    f"""
    WITH {MESSAGES_CTE}
    SELECT count(*) FILTER (WHERE role = 'user') AS questions,
           count(*) FILTER (WHERE role = 'assistant') AS answers,
           count(*) FILTER (WHERE role = 'assistant' AND status = 'stopped') AS stopped,
           count(*) FILTER (WHERE role = 'assistant' AND status = 'error') AS failed,
           count(*) FILTER (WHERE feedback = 1) AS up,
           count(*) FILTER (WHERE feedback = -1) AS down,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
             FILTER (WHERE role = 'assistant' AND status = 'complete') AS p50_latency_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
             FILTER (WHERE role = 'assistant' AND status = 'complete') AS p95_latency_ms,
           avg(latency_ms) FILTER (WHERE role = 'assistant' AND status = 'complete')
             AS avg_latency_ms,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ttft_ms)
             FILTER (WHERE role = 'assistant' AND status = 'complete') AS p50_ttft_ms
    FROM msg
    """
)

CONVERSATIONS_SQL = text(
    """
    SELECT
      count(*) FILTER (WHERE c.created_at >= :start AND c.created_at < :end) AS started,
      count(*) AS total
    FROM conversations c WHERE c.org_id = :org AND c.user_id = :user AND NOT c.is_eval
    """
)

TOKENS_SQL = text(
    f"""
    SELECT coalesce(sum(u.input_tokens), 0) AS input_tokens,
           coalesce(sum(u.output_tokens), 0) AS output_tokens
    FROM llm_usage u WHERE {USAGE_SCOPE}
    """
)

BOOKMARKS_SQL = text(
    """
    SELECT count(*) AS bookmarks
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.org_id = :org AND c.user_id = :user AND NOT c.is_eval
      AND m.bookmarked_at IS NOT NULL
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
    {MESSAGES_CTE},
    asked AS (
      SELECT date_trunc(:granularity, created_at AT TIME ZONE 'UTC') AS bucket,
             count(*) FILTER (WHERE role = 'user') AS questions,
             avg(latency_ms) FILTER (WHERE role = 'assistant' AND status = 'complete')
               AS avg_latency_ms
      FROM msg GROUP BY 1
    ),
    spent AS (
      SELECT date_trunc(:granularity, u.created_at AT TIME ZONE 'UTC') AS bucket,
             sum(u.input_tokens) AS input_tokens, sum(u.output_tokens) AS output_tokens
      FROM llm_usage u WHERE {USAGE_SCOPE} GROUP BY 1
    )
    SELECT b.bucket::date AS date,
           coalesce(a.questions, 0) AS questions,
           coalesce(s.input_tokens, 0) AS input_tokens,
           coalesce(s.output_tokens, 0) AS output_tokens,
           a.avg_latency_ms
    FROM buckets b
    LEFT JOIN asked a ON a.bucket = b.bucket
    LEFT JOIN spent s ON s.bucket = b.bucket
    ORDER BY b.bucket
    """
)


async def my_analytics(
    session: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> dict[str, Any]:
    params = {"org": org_id, "user": user_id, "start": start, "end": end}
    messages = (await session.execute(TOTALS_SQL, params)).one()._mapping
    conversations = (await session.execute(CONVERSATIONS_SQL, params)).one()._mapping
    tokens = (await session.execute(TOKENS_SQL, params)).one()._mapping
    bookmarks = (await session.execute(BOOKMARKS_SQL, params)).scalar_one()
    timeseries = await session.execute(
        TIMESERIES_SQL, {**params, "granularity": granularity, "step": STEPS[granularity]}
    )
    return {
        "range": {"from": start, "to": end, "granularity": granularity, "org_id": org_id},
        "totals": {
            **{key: _clean(value) for key, value in messages.items()},
            "conversations": conversations["started"],
            "conversations_total": conversations["total"],
            "input_tokens": int(tokens["input_tokens"]),
            "output_tokens": int(tokens["output_tokens"]),
            "total_tokens": int(tokens["input_tokens"] + tokens["output_tokens"]),
            "bookmarks": bookmarks,
        },
        "timeseries": _rows(timeseries),
    }
