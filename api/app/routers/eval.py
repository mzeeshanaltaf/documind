"""Evaluation-harness hooks (platform admins only): retrieval without an answer, a document's
chunks, the config fingerprint, and per-run usage and cleanup. Tagging itself
(`X-Eval-Run-Id` / `X-Eval-Case-Id`) lives in `core/eval.py` and also applies to chat."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.core.eval import EvalDep, check_eval_id
from app.core.security import AdminDep, OrgDep, SessionDep
from app.schemas.eval import RetrieveRequest
from app.services import eval as service

router = APIRouter(tags=["eval"])


@router.post("/orgs/{org_id}/retrieve")
async def retrieve(
    org: OrgDep, admin: AdminDep, session: SessionDep, eval_ctx: EvalDep, body: RetrieveRequest
) -> dict[str, Any]:
    """Route, embed once, and retrieve per mode, with full sources and scores. No answer, no
    conversation, no quota; usage rows carry the eval tags when sent."""
    return await service.retrieve_contexts(session, org.org_id, admin, body, eval_ctx)


@router.get("/orgs/{org_id}/documents/{document_id}/chunks")
async def document_chunks(
    org: OrgDep,
    _: AdminDep,
    session: SessionDep,
    document_id: uuid.UUID,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=service.MAX_CHUNKS_PAGE)] = service.MAX_CHUNKS_PAGE,
) -> dict[str, Any]:
    """A document's chunks in reading order (the displayed `text`, not the embedded one)."""
    return await service.document_chunks(
        session, org.org_id, document_id, offset=offset, limit=limit
    )


@router.get("/admin/eval/info")
async def eval_info(_: AdminDep) -> dict[str, Any]:
    """Version, default settings, models, prompt hashes, retrieval constants, pricing hash."""
    return service.eval_info()


@router.get("/admin/eval-runs/{run_id}/usage")
async def run_usage(_: AdminDep, session: SessionDep, run_id: str) -> dict[str, Any]:
    """LLM usage of one eval run: totals, per operation × model and per case."""
    return await service.run_usage(session, check_eval_id(run_id, "run_id"))


@router.delete("/admin/eval-runs/{run_id}/conversations")
async def delete_run_conversations(_: AdminDep, session: SessionDep, run_id: str) -> dict[str, int]:
    """Delete the run's eval conversations (their messages cascade; usage rows stay)."""
    deleted = await service.delete_run_conversations(session, check_eval_id(run_id, "run_id"))
    return {"deleted": deleted}
