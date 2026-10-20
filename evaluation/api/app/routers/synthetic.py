"""Synthetic test sets (E7): generation batches, the review queue and commits into datasets."""

import uuid
from typing import Literal

from fastapi import APIRouter, Response, status

from app.core.security import AdminDep, SessionDep
from app.documind.client import get_documind
from app.models import SyntheticBatch
from app.models.enums import BatchKind, BatchStatus, SyntheticType
from app.schemas.datasets import DatasetRef, VersionOut
from app.schemas.synthetic import (
    BatchCounts,
    BatchIn,
    BatchListOut,
    BatchOut,
    CandidateListOut,
    CandidateOut,
    CandidatePatch,
    CommitIn,
    CommitOut,
    CommitSkip,
    RejectIn,
    ResumeIn,
)
from app.services import synthetic as service
from app.services import synthetic_review as review

router = APIRouter(tags=["synthetic"])

CandidateFilter = Literal["queued", "pending", "approved", "rejected"]


async def _out(session: SessionDep, batches: list[SyntheticBatch]) -> list[BatchOut]:
    counts = await service.candidate_counts(session, [b.id for b in batches])
    datasets = await service.datasets_by_id(session, (b.target_dataset_id for b in batches))
    out = []
    for batch in batches:
        item = BatchOut.model_validate(batch)
        # The catalog is the generator's input, not something a client needs.
        item.config = {k: v for k, v in batch.config.items() if k != "catalog"}
        item.estimate_usd = float(service.estimate(batch.kind, batch.candidate_count))
        entry = counts.get(batch.id) or {"counts": {}, "by_type": {}}
        item.counts = BatchCounts(**entry["counts"])
        item.by_type = {k: BatchCounts(**v) for k, v in sorted(entry["by_type"].items())}
        dataset = datasets.get(batch.target_dataset_id) if batch.target_dataset_id else None
        item.target_dataset = DatasetRef.model_validate(dataset) if dataset else None
        out.append(item)
    return out


async def _one(session: SessionDep, batch: SyntheticBatch) -> BatchOut:
    return (await _out(session, [batch]))[0]


@router.post("/synthetic-batches", status_code=status.HTTP_201_CREATED)
async def create_batch(admin: AdminDep, session: SessionDep, body: BatchIn) -> BatchOut:
    """Samples the seeds from DocuMind's chunks (or collects the dataset's cases for enrichment)
    and queues one generation job per candidate."""
    batch = await service.create_batch(session, body, get_documind(), admin.id)
    await session.commit()
    return await _one(session, batch)


@router.get("/synthetic-batches")
async def list_batches(
    _: AdminDep,
    session: SessionDep,
    kind: BatchKind | None = None,
    status: BatchStatus | None = None,
) -> BatchListOut:
    batches = await service.list_batches(session, kind=kind, status=status)
    return BatchListOut(batches=await _out(session, batches))


@router.get("/synthetic-batches/{batch_id}")
async def get_batch(_: AdminDep, session: SessionDep, batch_id: uuid.UUID) -> BatchOut:
    return await _one(session, await service.get_batch_or_404(session, batch_id))


@router.get("/synthetic-batches/{batch_id}/candidates")
async def list_candidates(
    _: AdminDep,
    session: SessionDep,
    batch_id: uuid.UUID,
    status: CandidateFilter | None = None,
    type: SyntheticType | None = None,
) -> CandidateListOut:
    await service.get_batch_or_404(session, batch_id)
    rows = await service.list_candidates(session, batch_id, status=status, type=type)
    return CandidateListOut(
        candidates=[CandidateOut.model_validate(r) for r in rows], total=len(rows)
    )


@router.post("/synthetic-batches/{batch_id}/resume")
async def resume_batch(
    _: AdminDep, session: SessionDep, batch_id: uuid.UUID, body: ResumeIn | None = None
) -> BatchOut:
    """A batch paused at its cost cap (or by an Anthropic account error) continues; pass a
    higher `max_cost_usd` when the cap was reached."""
    batch = await service.resume_batch(session, batch_id, body.max_cost_usd if body else None)
    await session.commit()
    return await _one(session, batch)


@router.post("/synthetic-batches/{batch_id}/commit")
async def commit_batch(
    admin: AdminDep, session: SessionDep, batch_id: uuid.UUID, body: CommitIn | None = None
) -> CommitOut:
    result = await review.commit(session, batch_id, body.dataset_id if body else None, admin.id)
    await session.commit()
    return CommitOut(
        dataset=DatasetRef.model_validate(result["dataset"]),
        version=VersionOut.model_validate(result["version"]),
        added=result["added"],
        updated=result["updated"],
        skipped=[CommitSkip(**s) for s in result["skipped"]],
    )


@router.delete("/synthetic-batches/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_batch(_: AdminDep, session: SessionDep, batch_id: uuid.UUID) -> Response:
    await service.delete_batch(session, batch_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- candidates --------------------------------------------------------------------------------


@router.get("/candidates/{candidate_id}")
async def get_candidate(_: AdminDep, session: SessionDep, candidate_id: uuid.UUID) -> CandidateOut:
    candidate = await review.get_candidate_or_404(session, candidate_id, for_update=False)
    return CandidateOut.model_validate(candidate)


@router.patch("/candidates/{candidate_id}")
async def patch_candidate(
    admin: AdminDep, session: SessionDep, candidate_id: uuid.UUID, body: CandidatePatch
) -> CandidateOut:
    candidate = await review.get_candidate_or_404(session, candidate_id)
    await review.patch_candidate(session, candidate, body, admin.id)
    await session.commit()
    return CandidateOut.model_validate(candidate)


@router.post("/candidates/{candidate_id}/approve")
async def approve_candidate(
    admin: AdminDep, session: SessionDep, candidate_id: uuid.UUID
) -> CandidateOut:
    candidate = await review.get_candidate_or_404(session, candidate_id)
    await review.approve(session, candidate, admin.id)
    await session.commit()
    return CandidateOut.model_validate(candidate)


@router.post("/candidates/{candidate_id}/reject")
async def reject_candidate(
    admin: AdminDep, session: SessionDep, candidate_id: uuid.UUID, body: RejectIn | None = None
) -> CandidateOut:
    candidate = await review.get_candidate_or_404(session, candidate_id)
    await review.reject(session, candidate, admin.id, body.reason if body else None)
    await session.commit()
    return CandidateOut.model_validate(candidate)


@router.post("/candidates/{candidate_id}/restore")
async def restore_candidate(
    admin: AdminDep, session: SessionDep, candidate_id: uuid.UUID
) -> CandidateOut:
    """Back to `pending` (e.g. an auto-rejected candidate a human wants to look at again)."""
    candidate = await review.get_candidate_or_404(session, candidate_id)
    await review.restore(session, candidate, admin.id)
    await session.commit()
    return CandidateOut.model_validate(candidate)
