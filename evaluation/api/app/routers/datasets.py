"""Datasets, versions, cases, import and export. Published versions are read-only (409
`version_published`)."""

import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Query, Response, UploadFile, status
from fastapi.responses import PlainTextResponse
from pydantic import TypeAdapter, ValidationError

from app.core.errors import ApiError
from app.core.security import AdminDep, SessionDep
from app.documind.client import get_documind
from app.models import Dataset, DatasetVersion
from app.models.enums import DatasetKind
from app.schemas.datasets import (
    SLUG_PATTERN,
    CaseIn,
    CaseListOut,
    CaseOut,
    CasePatch,
    DatasetDetailOut,
    DatasetIn,
    DatasetListOut,
    DatasetOut,
    DatasetPatch,
    DatasetRef,
    ImportOut,
    NewVersionIn,
    VersionDetailOut,
    VersionOut,
)
from app.services import datasets as service
from app.services.importer import ImportOptions, import_jsonl

router = APIRouter(tags=["datasets"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _dataset_out(
    dataset: Dataset, latest: DatasetVersion | None, published: DatasetVersion | None
) -> DatasetOut:
    out = DatasetOut.model_validate(dataset)
    out.latest_version = VersionOut.model_validate(latest) if latest else None
    out.latest_published = VersionOut.model_validate(published) if published else None
    return out


async def _detail(session: SessionDep, dataset: Dataset) -> DatasetDetailOut:
    versions = await service.versions_of(session, dataset.id)
    published = next((v for v in versions if v.status == "published"), None)
    base = _dataset_out(dataset, versions[0] if versions else None, published)
    return DatasetDetailOut(
        **base.model_dump(), versions=[VersionOut.model_validate(v) for v in versions]
    )


# --- datasets --------------------------------------------------------------------------------


@router.get("/datasets")
async def list_datasets(
    _: AdminDep, session: SessionDep, include_archived: bool = False
) -> DatasetListOut:
    rows = await service.list_datasets(session, include_archived=include_archived)
    return DatasetListOut(datasets=[_dataset_out(*row) for row in rows])


@router.post("/datasets", status_code=status.HTTP_201_CREATED)
async def create_dataset(admin: AdminDep, session: SessionDep, body: DatasetIn) -> DatasetDetailOut:
    """Creates the dataset with an empty draft v1."""
    dataset, _ = await service.create_dataset(session, body, admin.id)
    await session.commit()
    return await _detail(session, dataset)


@router.post("/datasets/import")
async def import_dataset(
    admin: AdminDep,
    session: SessionDep,
    file: Annotated[UploadFile, File(description="JSONL, one case per line.")],
    dataset_slug: Annotated[str, Form(pattern=SLUG_PATTERN)],
    dataset_name: Annotated[str | None, Form()] = None,
    default_org_slug: Annotated[str | None, Form()] = None,
    kind: Annotated[DatasetKind, Form()] = "mixed",
    mapping: Annotated[
        str | None, Form(description='JSON {target_field: source_key}, e.g. {"type": "kind"}.')
    ] = None,
    defaults: Annotated[
        str | None, Form(description="JSON {field: value} for rows that lack the field.")
    ] = None,
    key_prefix: Annotated[str | None, Form()] = None,
    fill_departments: Annotated[bool, Form()] = True,
    publish: Annotated[bool, Form()] = False,
    preview: Annotated[bool, Query(description="Parse and validate only; save nothing.")] = False,
) -> ImportOut:
    """Cases from a JSONL file become a new version of `dataset_slug` (created if needed),
    holding exactly those cases. Missing `case_key`s become `<key_prefix>-001…`, a missing
    `type` is inferred, and `expected_departments` are read from DocuMind's documents."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ApiError(413, "too_large", "The file is larger than 5 MB.")
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ApiError(415, "not_utf8", "The file must be UTF-8 text.") from exc
    options = ImportOptions(
        dataset_slug=dataset_slug,
        dataset_name=dataset_name,
        default_org_slug=default_org_slug,
        kind=kind,
        mapping=_json_form("mapping", mapping),
        defaults=_json_form("defaults", defaults),
        key_prefix=key_prefix,
        fill_departments=fill_departments,
        publish=publish,
    )
    result = await import_jsonl(
        session,
        content,
        options,
        documind=get_documind(),
        created_by=admin.id,
        preview=preview,
    )
    if not preview:
        await session.commit()
    return ImportOut(
        preview=preview,
        cases=result.parsed.cases,
        errors=result.parsed.errors,
        warnings=result.parsed.warnings,
        dataset=DatasetRef.model_validate(result.dataset) if result.dataset else None,
        version=VersionOut.model_validate(result.version) if result.version else None,
        unchanged=result.unchanged,
    )


def _json_form(name: str, value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        return TypeAdapter(dict[str, Any]).validate_python(json.loads(value))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ApiError(422, "validation_error", f"{name} must be a JSON object.") from exc


@router.get("/datasets/{dataset_id}")
async def get_dataset(_: AdminDep, session: SessionDep, dataset_id: uuid.UUID) -> DatasetDetailOut:
    return await _detail(session, await service.get_dataset_or_404(session, dataset_id))


@router.patch("/datasets/{dataset_id}")
async def patch_dataset(
    _: AdminDep, session: SessionDep, dataset_id: uuid.UUID, body: DatasetPatch
) -> DatasetDetailOut:
    dataset = await service.get_dataset_or_404(session, dataset_id)
    await service.patch_dataset(session, dataset, body)
    await session.commit()
    return await _detail(session, dataset)


# --- versions --------------------------------------------------------------------------------


async def _version_detail(session: SessionDep, version: DatasetVersion) -> VersionDetailOut:
    dataset = await service.get_dataset_or_404(session, version.dataset_id)
    return VersionDetailOut(
        **VersionOut.model_validate(version).model_dump(),
        dataset=DatasetRef.model_validate(dataset),
    )


@router.post("/datasets/{dataset_id}/versions", status_code=status.HTTP_201_CREATED)
async def create_version(
    admin: AdminDep,
    session: SessionDep,
    dataset_id: uuid.UUID,
    body: NewVersionIn | None = None,
) -> VersionDetailOut:
    """A new draft copied from the latest version (409 `draft_exists` if one is open)."""
    dataset = await service.get_dataset_or_404(session, dataset_id)
    version = await service.create_version(session, dataset, admin.id, body.notes if body else None)
    await session.commit()
    return await _version_detail(session, version)


@router.get("/dataset-versions/{version_id}")
async def get_version(_: AdminDep, session: SessionDep, version_id: uuid.UUID) -> VersionDetailOut:
    return await _version_detail(session, await service.get_version_or_404(session, version_id))


@router.post("/dataset-versions/{version_id}/publish")
async def publish_version(
    admin: AdminDep, session: SessionDep, version_id: uuid.UUID
) -> VersionDetailOut:
    """Freeze the draft: `content_hash` is computed and the version can't be edited again."""
    version = await service.publish_version(session, version_id, admin.id)
    await session.commit()
    return await _version_detail(session, version)


@router.get(
    "/dataset-versions/{version_id}/export",
    response_class=PlainTextResponse,
    responses={200: {"content": {"application/x-ndjson": {}}}},
)
async def export_version(_: AdminDep, session: SessionDep, version_id: uuid.UUID) -> Response:
    version = await service.get_version_or_404(session, version_id)
    dataset = await service.get_dataset_or_404(session, version.dataset_id)
    body = service.export_jsonl(await service.cases_of(session, version.id))
    filename = f"{dataset.slug}-v{version.version}.jsonl"
    return Response(
        body,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- cases -----------------------------------------------------------------------------------


@router.get("/dataset-versions/{version_id}/cases")
async def list_cases(
    _: AdminDep,
    session: SessionDep,
    version_id: uuid.UUID,
    case_type: Annotated[str | None, Query(alias="type")] = None,
    tag: str | None = None,
) -> CaseListOut:
    await service.get_version_or_404(session, version_id)
    cases = await service.cases_of(session, version_id)
    if case_type:
        cases = [c for c in cases if c.type == case_type]
    if tag:
        cases = [c for c in cases if tag in (c.tags or [])]
    return CaseListOut(cases=[CaseOut.model_validate(c) for c in cases], total=len(cases))


@router.post("/dataset-versions/{version_id}/cases", status_code=status.HTTP_201_CREATED)
async def add_case(
    _: AdminDep, session: SessionDep, version_id: uuid.UUID, body: CaseIn
) -> CaseOut:
    version = await service.get_version_or_404(session, version_id, for_update=True)
    [case] = await service.add_cases(session, version, [body])
    await session.commit()
    return CaseOut.model_validate(case)


@router.patch("/cases/{case_id}")
async def patch_case(
    _: AdminDep, session: SessionDep, case_id: uuid.UUID, body: CasePatch
) -> CaseOut:
    case = await service.get_case_or_404(session, case_id)
    case = await service.patch_case(session, case, body)
    await session.commit()
    return CaseOut.model_validate(case)


@router.delete("/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(_: AdminDep, session: SessionDep, case_id: uuid.UUID) -> Response:
    await service.delete_case(session, await service.get_case_or_404(session, case_id))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
