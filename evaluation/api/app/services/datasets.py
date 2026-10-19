"""Datasets, versions and cases. A published version is immutable; edits go into a draft copied
from the latest version. `content_hash` = sha256 of the canonical JSON of the cases."""

import hashlib
import json
import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.models import Case, Dataset, DatasetVersion
from app.schemas.datasets import (
    CONTENT_FIELDS,
    REQUIRED_PATCH_FIELDS,
    CaseFields,
    CaseIn,
    CasePatch,
    DatasetIn,
    DatasetPatch,
)

# --- canonical form & hash -------------------------------------------------------------------


def canonical_case(case: CaseFields | Mapping[str, Any]) -> dict[str, Any]:
    """The content of a case (no ids, positions or timestamps), normalized through the schema so
    a DB row, an API body and an import row with the same content compare equal."""
    if not isinstance(case, CaseFields):
        case = CaseFields.model_validate(
            {field: case.get(field) for field in CONTENT_FIELDS if case.get(field) is not None}
        )
    return case.model_dump(mode="json")


def content_hash(cases: Iterable[CaseFields | Mapping[str, Any]]) -> str:
    """Order-independent (cases are sorted by `case_key`), key-order-independent JSON hash."""
    canonical = sorted((canonical_case(case) for case in cases), key=lambda c: c["case_key"])
    blob = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def case_content(case: Case) -> dict[str, Any]:
    return {field: getattr(case, field) for field in CONTENT_FIELDS}


# --- loading & guards ------------------------------------------------------------------------


async def get_dataset_or_404(session: AsyncSession, dataset_id: uuid.UUID) -> Dataset:
    dataset = await session.get(Dataset, dataset_id)
    if dataset is None:
        raise ApiError(404, "not_found", "Dataset not found.")
    return dataset


async def get_version_or_404(
    session: AsyncSession, version_id: uuid.UUID, *, for_update: bool = False
) -> DatasetVersion:
    stmt = select(DatasetVersion).where(DatasetVersion.id == version_id)
    if for_update:
        stmt = stmt.with_for_update()
    version = (await session.execute(stmt)).scalar_one_or_none()
    if version is None:
        raise ApiError(404, "not_found", "Dataset version not found.")
    return version


def ensure_draft(version: DatasetVersion) -> None:
    if version.status != "draft":
        raise ApiError(
            409,
            "version_published",
            f"Version {version.version} is published and can't be edited; create a new version.",
            {"version_id": str(version.id)},
        )


async def versions_of(session: AsyncSession, dataset_id: uuid.UUID) -> list[DatasetVersion]:
    return list(
        (
            await session.execute(
                select(DatasetVersion)
                .where(DatasetVersion.dataset_id == dataset_id)
                .order_by(DatasetVersion.version.desc())
            )
        ).scalars()
    )


async def cases_of(session: AsyncSession, version_id: uuid.UUID) -> list[Case]:
    return list(
        (
            await session.execute(
                select(Case)
                .where(Case.dataset_version_id == version_id)
                .order_by(Case.position, Case.case_key)
            )
        ).scalars()
    )


# --- datasets --------------------------------------------------------------------------------


async def list_datasets(
    session: AsyncSession, *, include_archived: bool = False
) -> list[tuple[Dataset, DatasetVersion | None, DatasetVersion | None]]:
    """Each dataset with its latest version and its latest published version."""
    stmt = select(Dataset).order_by(Dataset.name)
    if not include_archived:
        stmt = stmt.where(Dataset.archived_at.is_(None))
    datasets = list((await session.execute(stmt)).scalars())
    versions = (
        (
            await session.execute(
                select(DatasetVersion)
                .where(DatasetVersion.dataset_id.in_([d.id for d in datasets]))
                .order_by(DatasetVersion.version.desc())
            )
        )
        .scalars()
        .all()
        if datasets
        else []
    )
    latest: dict[uuid.UUID, DatasetVersion] = {}
    published: dict[uuid.UUID, DatasetVersion] = {}
    for version in versions:
        latest.setdefault(version.dataset_id, version)
        if version.status == "published":
            published.setdefault(version.dataset_id, version)
    return [(d, latest.get(d.id), published.get(d.id)) for d in datasets]


async def create_dataset(
    session: AsyncSession, body: DatasetIn, created_by: str | None
) -> tuple[Dataset, DatasetVersion]:
    """A dataset starts with an empty draft v1, ready for cases."""
    exists = await session.scalar(select(Dataset.id).where(Dataset.slug == body.slug))
    if exists is not None:
        raise ApiError(409, "duplicate_slug", f"Dataset {body.slug!r} already exists.")
    dataset = Dataset(id=uuid.uuid4(), created_by=created_by, **body.model_dump())
    session.add(dataset)
    await session.flush()
    version = DatasetVersion(
        id=uuid.uuid4(), dataset_id=dataset.id, version=1, status="draft", created_by=created_by
    )
    session.add(version)
    await session.flush()
    return dataset, version


async def patch_dataset(session: AsyncSession, dataset: Dataset, body: DatasetPatch) -> Dataset:
    changes = body.model_dump(exclude_unset=True)
    if "archived" in changes:
        archived = changes.pop("archived")
        dataset.archived_at = datetime.now(UTC) if archived else None
    if changes.get("name", "") is None or changes.get("kind", "") is None:
        raise ApiError(422, "validation_error", "name and kind can't be null.")
    for field, value in changes.items():
        setattr(dataset, field, value)
    await session.flush()
    return dataset


# --- versions --------------------------------------------------------------------------------


async def create_version(
    session: AsyncSession,
    dataset: Dataset,
    created_by: str | None,
    notes: str | None = None,
    *,
    copy_cases: bool = True,
) -> DatasetVersion:
    """A new draft, copied from the latest version. One draft at a time."""
    versions = await versions_of(session, dataset.id)
    draft = next((v for v in versions if v.status == "draft"), None)
    if draft is not None:
        raise ApiError(
            409,
            "draft_exists",
            f"Version {draft.version} is already a draft; edit or publish it first.",
            {"version_id": str(draft.id)},
        )
    latest = versions[0] if versions else None
    version = DatasetVersion(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        version=(latest.version + 1) if latest else 1,
        status="draft",
        notes=notes,
        created_by=created_by,
    )
    session.add(version)
    await session.flush()
    if latest is not None and copy_cases:
        for case in await cases_of(session, latest.id):
            session.add(_copy_case(case, version.id))
        version.case_count = latest.case_count
        await session.flush()
    return version


def _copy_case(case: Case, version_id: uuid.UUID) -> Case:
    return Case(
        id=uuid.uuid4(), dataset_version_id=version_id, position=case.position, **case_content(case)
    )


async def publish_version(
    session: AsyncSession, version_id: uuid.UUID, published_by: str | None
) -> DatasetVersion:
    version = await get_version_or_404(session, version_id, for_update=True)
    ensure_draft(version)
    cases = await cases_of(session, version.id)
    if not cases:
        raise ApiError(422, "empty_version", "A version needs at least one case to be published.")
    version.status = "published"
    version.case_count = len(cases)
    version.content_hash = content_hash(case_content(case) for case in cases)
    version.published_at = datetime.now(UTC)
    version.published_by = published_by
    await session.flush()
    return version


# --- cases -----------------------------------------------------------------------------------


async def _key_taken(
    session: AsyncSession, version_id: uuid.UUID, case_key: str, exclude: uuid.UUID | None = None
) -> bool:
    stmt = select(Case.id).where(Case.dataset_version_id == version_id, Case.case_key == case_key)
    if exclude is not None:
        stmt = stmt.where(Case.id != exclude)
    return await session.scalar(stmt) is not None


def _duplicate_key(case_key: str) -> ApiError:
    return ApiError(409, "duplicate_case_key", f"Case key {case_key!r} is already in this version.")


async def add_cases(
    session: AsyncSession, version: DatasetVersion, bodies: Sequence[CaseIn | CaseFields]
) -> list[Case]:
    ensure_draft(version)
    position = await session.scalar(
        select(func.coalesce(func.max(Case.position), -1)).where(
            Case.dataset_version_id == version.id
        )
    )
    added = []
    for body in bodies:
        data = body.model_dump(mode="json")
        data["case_key"] = data.get("case_key") or f"case-{uuid.uuid4().hex[:8]}"
        if await _key_taken(session, version.id, data["case_key"]):
            raise _duplicate_key(data["case_key"])
        position += 1
        case = Case(id=uuid.uuid4(), dataset_version_id=version.id, position=position, **data)
        session.add(case)
        await session.flush()
        added.append(case)
    version.case_count += len(added)
    await session.flush()
    return added


async def get_case_or_404(session: AsyncSession, case_id: uuid.UUID) -> Case:
    case = await session.get(Case, case_id)
    if case is None:
        raise ApiError(404, "not_found", "Case not found.")
    return case


async def patch_case(session: AsyncSession, case: Case, body: CasePatch) -> Case:
    version = await get_version_or_404(session, case.dataset_version_id, for_update=True)
    ensure_draft(version)
    changes = body.model_dump(mode="json", exclude_unset=True)
    nulls = sorted(f for f in REQUIRED_PATCH_FIELDS if f in changes and changes[f] is None)
    if nulls:
        raise ApiError(422, "validation_error", f"These fields can't be null: {', '.join(nulls)}.")
    if "case_key" in changes and await _key_taken(
        session, version.id, changes["case_key"], exclude=case.id
    ):
        raise _duplicate_key(changes["case_key"])
    for field, value in changes.items():
        setattr(case, field, value)
    await session.flush()
    await session.refresh(case)
    return case


async def delete_case(session: AsyncSession, case: Case) -> None:
    version = await get_version_or_404(session, case.dataset_version_id, for_update=True)
    ensure_draft(version)
    await session.delete(case)
    version.case_count = max(0, version.case_count - 1)
    await session.flush()


def export_jsonl(cases: Sequence[Case]) -> str:
    """One canonical case per line, in position order; `POST /v1/datasets/import` reads it back
    with no mapping."""
    lines = (
        json.dumps(canonical_case(case_content(c)), ensure_ascii=False, sort_keys=True)
        for c in cases
    )
    return "".join(f"{line}\n" for line in lines)
