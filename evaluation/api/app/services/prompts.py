"""Reading the judge prompt registry: prompts, their versions, and a diff between two versions."""

import difflib
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.judge import registry
from app.models import Prompt, PromptVersion


async def list_prompts(session: AsyncSession) -> list[dict[str, Any]]:
    """Every prompt with its version count, latest version, and which version the file on disk
    is now (`current_version`; None when the file changed since the last sync)."""
    files = registry.load_prompts()  # fresh: the file may have changed since startup
    counts = dict(
        (
            await session.execute(
                select(PromptVersion.prompt_id, func.count()).group_by(PromptVersion.prompt_id)
            )
        ).all()
    )
    out = []
    for prompt in (await session.scalars(select(Prompt).order_by(Prompt.key))).all():
        latest = await session.scalar(
            select(PromptVersion)
            .where(PromptVersion.prompt_id == prompt.id)
            .order_by(PromptVersion.version.desc())
            .limit(1)
        )
        spec = files.get(prompt.key)
        current = (
            await session.scalar(
                select(PromptVersion.version).where(PromptVersion.sha256 == spec.sha256)
            )
            if spec
            else None
        )
        out.append(
            {
                "key": prompt.key,
                "kind": prompt.kind,
                "description": prompt.description,
                "versions": counts.get(prompt.id, 0),
                "latest": _version(latest, body=False) if latest else None,
                "current_version": current,
                "file_present": spec is not None,
            }
        )
    return out


def _version(row: PromptVersion, *, body: bool = True) -> dict[str, Any]:
    data = {
        "id": row.id,
        "version": row.version,
        "sha256": row.sha256,
        "model": row.model,
        "effort": row.effort,
        "thinking": row.thinking,
        "params": row.params,
        "created_at": row.created_at,
    }
    if body:
        data |= {"body": row.body, "output_schema": row.output_schema}
    return data


async def _prompt_or_404(session: AsyncSession, key: str) -> Prompt:
    prompt = await session.scalar(select(Prompt).where(Prompt.key == key))
    if prompt is None:
        raise ApiError(404, "not_found", f"No prompt {key!r}.")
    return prompt


async def list_versions(session: AsyncSession, key: str) -> list[dict[str, Any]]:
    prompt = await _prompt_or_404(session, key)
    rows = await session.scalars(
        select(PromptVersion)
        .where(PromptVersion.prompt_id == prompt.id)
        .order_by(PromptVersion.version.desc())
    )
    return [_version(row) for row in rows.all()]


async def diff(session: AsyncSession, key: str, from_version: int, to_version: int) -> str:
    """A unified diff of two versions' bodies (system prompt + task line). Changes to the
    output schema or params show up in `/versions`, not here."""
    prompt = await _prompt_or_404(session, key)
    rows = {
        row.version: row
        for row in (
            await session.scalars(
                select(PromptVersion).where(
                    PromptVersion.prompt_id == prompt.id,
                    PromptVersion.version.in_((from_version, to_version)),
                )
            )
        ).all()
    }
    missing = [v for v in (from_version, to_version) if v not in rows]
    if missing:
        raise ApiError(404, "version_not_found", f"{key} has no version {missing[0]}.")
    lines = difflib.unified_diff(
        rows[from_version].body.splitlines(keepends=True),
        rows[to_version].body.splitlines(keepends=True),
        fromfile=f"{key} v{from_version}",
        tofile=f"{key} v{to_version}",
    )
    return "".join(lines)
