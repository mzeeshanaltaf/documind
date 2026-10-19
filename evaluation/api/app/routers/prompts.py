"""Judge prompts: the registry synced from `app/judge/prompts/*.md` (one version per content
hash)."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.core.security import AdminDep, SessionDep
from app.schemas.prompts import PromptDiffOut, PromptOut, PromptVersionOut
from app.services import prompts as service

router = APIRouter(prefix="/prompts", tags=["prompts"])


@router.get("")
async def list_prompts(_: AdminDep, session: SessionDep) -> list[PromptOut]:
    return [PromptOut.model_validate(p) for p in await service.list_prompts(session)]


@router.get("/{key}/versions")
async def list_versions(_: AdminDep, session: SessionDep, key: str) -> list[PromptVersionOut]:
    """Newest first, with the full body and output schema."""
    return [PromptVersionOut.model_validate(v) for v in await service.list_versions(session, key)]


@router.get("/{key}/diff")
async def diff_versions(
    _: AdminDep,
    session: SessionDep,
    key: str,
    from_version: Annotated[int, Query(alias="from", ge=1)],
    to_version: Annotated[int, Query(alias="to", ge=1)],
) -> PromptDiffOut:
    """A unified diff of the two versions' bodies."""
    text = await service.diff(session, key, from_version, to_version)
    return PromptDiffOut(key=key, from_version=from_version, to_version=to_version, diff=text)
