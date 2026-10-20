"""Human review of synthetic candidates and committing the approved ones (E7).

- **Edit** (`PATCH`): any change marks the candidate `edited`. An enrichment candidate's question
  is the existing case's and can't change.
- **Approve / reject / restore**: an auto-rejected candidate can be approved directly or restored
  to `pending`; `auto_rejected` stays true as history (approval rates of auto-rejects). A
  committed candidate is frozen.
- **Commit**: approved, uncommitted candidates go into the target dataset's draft version (the
  existing draft, else a new one copied from the latest version). Published versions are never
  touched. New cases get `case_key = syn-<batch8>-NNN` and `source = synthetic`; enrichment
  candidates set `reference_answer` + `key_facts` on the draft's case with their
  `target_case_key`.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.models import Case, Dataset, DatasetVersion, SyntheticBatch, SyntheticCandidate
from app.schemas.datasets import CaseFields
from app.schemas.synthetic import REQUIRED_CANDIDATE_FIELDS, CandidatePatch
from app.services import datasets as dataset_service
from app.services import synthetic


async def get_candidate_or_404(
    session: AsyncSession, candidate_id: uuid.UUID, *, for_update: bool = True
) -> SyntheticCandidate:
    stmt = select(SyntheticCandidate).where(SyntheticCandidate.id == candidate_id)
    if for_update:
        stmt = stmt.with_for_update()
    candidate = (await session.execute(stmt)).scalar_one_or_none()
    if candidate is None:
        raise ApiError(404, "not_found", "Candidate not found.")
    return candidate


def _ensure_open(candidate: SyntheticCandidate, *, generated: bool = True) -> None:
    if candidate.case_id is not None:
        raise ApiError(409, "committed", "The candidate is already in a dataset.")
    if generated and candidate.gen_status != "generated":
        raise ApiError(
            409, "not_generated", f"The candidate is {candidate.gen_status}, not generated."
        )


def _reviewed(candidate: SyntheticCandidate, reviewer: str | None) -> None:
    candidate.reviewer_id = reviewer
    candidate.reviewed_at = datetime.now(UTC)


async def patch_candidate(
    session: AsyncSession, candidate: SyntheticCandidate, body: CandidatePatch, reviewer: str | None
) -> SyntheticCandidate:
    _ensure_open(candidate)
    changes = body.model_dump(mode="json", exclude_unset=True)
    if body.key_facts is not None:
        # exclude_unset reaches into nested models and would drop a fact's default weight.
        changes["key_facts"] = [fact.model_dump(mode="json") for fact in body.key_facts]
    nulls = sorted(f for f in REQUIRED_CANDIDATE_FIELDS if f in changes and changes[f] is None)
    if nulls:
        raise ApiError(422, "validation_error", f"These fields can't be null: {', '.join(nulls)}.")
    if candidate.target_case_key and "question" in changes:
        if changes["question"] != candidate.question:
            raise ApiError(
                422, "question_locked", "An enrichment candidate keeps its case's question."
            )
        changes.pop("question")
    if "question" in changes:
        changes["question"] = changes["question"].strip()
    changed = False
    for field, value in changes.items():
        if getattr(candidate, field) != value:
            setattr(candidate, field, value)
            changed = True
    if changed:
        candidate.edited = True
        _reviewed(candidate, reviewer)
    await session.flush()
    return candidate


async def approve(
    session: AsyncSession, candidate: SyntheticCandidate, reviewer: str | None
) -> SyntheticCandidate:
    _ensure_open(candidate)
    if not (candidate.question or "").strip():
        raise ApiError(422, "no_question", "The candidate has no question.")
    candidate.status, candidate.reject_reason = "approved", None
    _reviewed(candidate, reviewer)
    await session.flush()
    return candidate


async def reject(
    session: AsyncSession, candidate: SyntheticCandidate, reviewer: str | None, reason: str | None
) -> SyntheticCandidate:
    _ensure_open(candidate, generated=False)
    candidate.status = "rejected"
    candidate.reject_reason = (reason or "").strip() or "rejected by reviewer"
    _reviewed(candidate, reviewer)
    await session.flush()
    return candidate


async def restore(
    session: AsyncSession, candidate: SyntheticCandidate, reviewer: str | None
) -> SyntheticCandidate:
    _ensure_open(candidate)
    candidate.status, candidate.reject_reason = "pending", None
    _reviewed(candidate, reviewer)
    await session.flush()
    return candidate


# --- commit ------------------------------------------------------------------------------------


def case_key(batch_id: uuid.UUID, ordinal: int) -> str:
    return f"syn-{batch_id.hex[:8]}-{ordinal:03d}"


def case_fields(batch: SyntheticBatch, candidate: SyntheticCandidate) -> CaseFields:
    return CaseFields(
        case_key=case_key(batch.id, candidate.ordinal),
        type=candidate.type,  # type: ignore[arg-type]
        question=candidate.question or "",
        setup_turns=list(candidate.setup_turns or []),
        reference_answer=candidate.reference_answer,
        key_facts=candidate.key_facts or [],  # type: ignore[arg-type]
        expected_doc_codes=list(candidate.expected_doc_codes or []),
        expected_sections=list(candidate.expected_sections or []),
        expected_pages=candidate.expected_pages,
        expected_departments=list(candidate.expected_departments or []),
        expected_jurisdiction=candidate.expected_jurisdiction,
        expected_behavior=candidate.expected_behavior,  # type: ignore[arg-type]
        source="synthetic",
        notes=candidate.rationale,
    )


async def draft_of(session: AsyncSession, dataset: Dataset, actor: str | None) -> DatasetVersion:
    """The dataset's draft, or a new one copied from its latest version."""
    versions = await dataset_service.versions_of(session, dataset.id)
    draft = next((v for v in versions if v.status == "draft"), None)
    if draft is not None:
        return await dataset_service.get_version_or_404(session, draft.id, for_update=True)
    return await dataset_service.create_version(session, dataset, actor)


async def commit(
    session: AsyncSession, batch_id: uuid.UUID, dataset_id: uuid.UUID | None, actor: str | None
) -> dict[str, Any]:
    batch = await synthetic.get_batch_or_404(session, batch_id, for_update=True)
    dataset_id = dataset_id or batch.target_dataset_id
    if dataset_id is None:
        raise ApiError(422, "dataset_required", "Pick the dataset to commit into.")
    dataset = await dataset_service.get_dataset_or_404(session, dataset_id)
    candidates = list(
        (
            await session.execute(
                select(SyntheticCandidate)
                .where(
                    SyntheticCandidate.batch_id == batch.id,
                    SyntheticCandidate.status == "approved",
                    SyntheticCandidate.gen_status == "generated",
                    SyntheticCandidate.case_id.is_(None),
                )
                .order_by(SyntheticCandidate.ordinal)
                .with_for_update()
            )
        ).scalars()
    )
    if not candidates:
        raise ApiError(422, "nothing_to_commit", "No approved, uncommitted candidates.")
    draft = await draft_of(session, dataset, actor)
    existing = {
        c.case_key: c
        for c in (
            await session.execute(select(Case).where(Case.dataset_version_id == draft.id))
        ).scalars()
    }
    skipped: list[dict[str, Any]] = []
    added = updated = 0
    if batch.kind == "enrichment":
        for candidate in candidates:
            target = existing.get(candidate.target_case_key or "")
            if target is None:
                skipped.append({"candidate_id": candidate.id, "reason": "case_not_in_draft"})
                continue
            target.reference_answer = candidate.reference_answer
            target.key_facts = candidate.key_facts or []
            candidate.case_id = target.id
            updated += 1
    else:
        new: list[tuple[SyntheticCandidate, CaseFields]] = []
        for candidate in candidates:
            try:
                fields = case_fields(batch, candidate)
            except ValidationError as exc:
                reason = f"invalid: {exc.errors()[0].get('msg', 'validation error')}"
                skipped.append({"candidate_id": candidate.id, "reason": reason})
                continue
            if fields.case_key in existing:
                skipped.append({"candidate_id": candidate.id, "reason": "case_key_exists"})
                continue
            new.append((candidate, fields))
        if new:
            cases = await dataset_service.add_cases(session, draft, [f for _, f in new])
            for (candidate, _), row in zip(new, cases, strict=True):
                candidate.case_id = row.id
            added = len(cases)
    batch.committed_at = datetime.now(UTC)
    batch.committed_version_id = draft.id
    await session.flush()
    return {
        "dataset": dataset,
        "version": draft,
        "added": added,
        "updated": updated,
        "skipped": skipped,
    }
