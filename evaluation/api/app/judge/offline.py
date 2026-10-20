"""Offline judging (`EVAL_JUDGE_MODE=offline`, local only).

`client.call()` doesn't reach Anthropic: it parks the request as an `offline_tasks` row and
raises `RetryLater`, so the job (case_judge, synthetic_generate) comes back every
`EVAL_OFFLINE_POLL_S` seconds. Claude Code reads the pending tasks, answers them in the prompt's
output schema and stores each answer (`scripts.offline_tasks import`) as a `judge_calls` row with
the task's `request_hash`; the job's next attempt finds it through the normal retry reuse. A
prompt that depends on an earlier answer (claims_verify after claims_extract, validate after
generate) parks its task in a later round.

Answers are free (`cost_usd` 0) and carry `model_actual = OFFLINE_MODEL`, so they are never
mistaken for Haiku's, and runs started in this mode say so in `snapshot.eval.judge_mode`.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.config import get_settings
from app.core.db import session_scope
from app.judge import registry
from app.models import JudgeCall, OfflineTask, Prompt, PromptVersion

OFFLINE_MODEL = "claude-code-offline"


def enabled() -> bool:
    """Local only: a deployed build (`GIT_SHA` set by the Dockerfile) always uses the API, even
    if `EVAL_JUDGE_MODE=offline` leaks into its environment."""
    settings = get_settings()
    return settings.eval_judge_mode == "offline" and settings.git_sha == "dev"


async def park(
    *,
    owner_id: uuid.UUID,
    digest: str,
    run_id: uuid.UUID | None,
    run_case_id: uuid.UUID | None,
    batch_id: uuid.UUID | None,
    candidate_id: uuid.UUID | None,
    purpose: str,
    prompt_version_id: uuid.UUID | None,
    model: str,
    effort: str | None,
    sample_idx: int,
    system: str,
    packet: str,
    task: str,
    output_schema: dict[str, Any],
) -> None:
    """Record the request once (a retry of the same job finds its row)."""
    stmt = (
        insert(OfflineTask)
        .values(
            id=uuid.uuid4(),
            owner_id=owner_id,
            request_hash=digest,
            run_id=run_id,
            run_case_id=run_case_id,
            batch_id=batch_id,
            candidate_id=candidate_id,
            purpose=purpose,
            prompt_version_id=prompt_version_id,
            model=model,
            effort=effort,
            sample_idx=sample_idx,
            system=system,
            packet=packet,
            task=task,
            output_schema=output_schema,
        )
        .on_conflict_do_nothing(index_elements=["owner_id", "request_hash"])
    )
    async with session_scope() as session:
        await session.execute(stmt)


@dataclass(frozen=True)
class Fulfilled:
    task_id: uuid.UUID
    ok: bool
    error: str | None = None


async def fulfil(task_id: uuid.UUID, output: Any, *, status: str = "ok") -> Fulfilled:
    """Validate `output` against the prompt's schema and store it as the call's answer.
    `status="refusal"` stores a refusal instead (output ignored)."""
    async with session_scope() as session:
        task = (
            await session.execute(
                select(OfflineTask).where(OfflineTask.id == task_id).with_for_update()
            )
        ).scalar_one_or_none()
        if task is None:
            return Fulfilled(task_id, False, "unknown task")
        if task.status != "pending":
            return Fulfilled(task_id, False, f"task is {task.status}")
        if task.prompt_version_id is None:
            return Fulfilled(task_id, False, "task has no prompt version")
        spec = await registry.load_version(session, task.prompt_version_id)
        parsed = None
        error = None
        if status == "ok":
            try:
                parsed = spec.output_model.model_validate(output)
            except ValidationError as exc:
                return Fulfilled(task_id, False, f"invalid output: {exc.errors()[:3]}")
        else:
            error = "refusal (offline)"
        session.add(
            JudgeCall(
                id=uuid.uuid4(),
                run_id=task.run_id,
                run_case_id=task.run_case_id,
                batch_id=task.batch_id,
                candidate_id=task.candidate_id,
                purpose=task.purpose,
                prompt_version_id=task.prompt_version_id,
                model=task.model,
                model_actual=OFFLINE_MODEL,
                effort=task.effort,
                sample_idx=task.sample_idx,
                request_hash=task.request_hash,
                stop_reason="refusal" if status != "ok" else "end_turn",
                status="ok" if status == "ok" else "refusal",
                error=error,
                response={
                    "model": OFFLINE_MODEL,
                    "output": parsed.model_dump(mode="json") if parsed is not None else None,
                    "text": None,
                },
            )
        )
        task.status = "fulfilled"
        task.fulfilled_at = datetime.now(UTC)
    return Fulfilled(task_id, True)


async def cancel_for(*, run_id: uuid.UUID | None = None, batch_id: uuid.UUID | None = None) -> int:
    """Drop the pending tasks of a stopped run or batch."""
    owner = OfflineTask.run_id == run_id if run_id else OfflineTask.batch_id == batch_id
    async with session_scope() as session:
        result = await session.execute(
            update(OfflineTask)
            .where(owner, OfflineTask.status == "pending")
            .values(status="cancelled")
        )
        return result.rowcount or 0


async def pending(limit: int, prompt_key: str | None = None) -> list[OfflineTask]:
    async with session_scope() as session:
        query = select(OfflineTask).where(OfflineTask.status == "pending")
        if prompt_key:
            query = (
                query.join(PromptVersion, PromptVersion.id == OfflineTask.prompt_version_id)
                .join(Prompt, Prompt.id == PromptVersion.prompt_id)
                .where(Prompt.key == prompt_key)
            )
        rows = await session.scalars(query.order_by(OfflineTask.created_at).limit(limit))
        return list(rows)


async def prompt_keys(tasks: list[OfflineTask]) -> dict[uuid.UUID, str]:
    """The prompt key (`gen.validate`, `judge.key_facts`, …) of each task's prompt version."""
    keys: dict[uuid.UUID, str] = {}
    async with session_scope() as session:
        for version_id in {t.prompt_version_id for t in tasks if t.prompt_version_id}:
            keys[version_id] = (await registry.load_version(session, version_id)).key
    return keys


async def counts() -> dict[tuple[str, str], int]:
    """`(purpose, status)` → count."""
    async with session_scope() as session:
        rows = await session.execute(
            select(Prompt.key, OfflineTask.status, func.count())
            .join(PromptVersion, PromptVersion.id == OfflineTask.prompt_version_id)
            .join(Prompt, Prompt.id == PromptVersion.prompt_id)
            .group_by(Prompt.key, OfflineTask.status)
        )
        return {(key, status): n for key, status, n in rows}
