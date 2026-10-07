"""Documents API under /v1/orgs/{org_id}/documents: upload, list, metadata, file, reindex."""

import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import StreamingResponse

from app.core import storage
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import AdminDep, OrgDep, SessionDep
from app.models.document import DOCUMENT_STATUSES, Document
from app.schemas.documents import (
    DocumentDetailOut,
    DocumentListOut,
    DocumentOut,
    DocumentPatch,
    DocumentPatchOut,
    JobOut,
    UploadItemOut,
    UploadOut,
)
from app.services import documents as service

router = APIRouter(prefix="/orgs/{org_id}/documents", tags=["documents"])

# An all-failed upload answers with the status of its first failure.
FAILURE_STATUS = {
    "duplicate": status.HTTP_409_CONFLICT,
    "not_pdf": status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
    "too_large": status.HTTP_413_CONTENT_TOO_LARGE,
    "empty": status.HTTP_400_BAD_REQUEST,
}


async def _document_or_404(session: SessionDep, org_id: str, document_id: uuid.UUID) -> Document:
    document = await service.get_document(session, org_id, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found.")
    return document


async def _detail(session: SessionDep, document: Document) -> DocumentDetailOut:
    job = await service.latest_job(session, document.id)
    return DocumentDetailOut.model_validate(document).model_copy(
        update={
            "job": JobOut.model_validate(job) if job else None,
            "chunk_count": await service.chunk_count(session, document.id),
        }
    )


@router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    responses={409: {"description": "Duplicate (details hold the existing id)"}},
)
async def upload_documents(
    org: OrgDep,
    actor: AdminDep,
    session: SessionDep,
    files: Annotated[list[UploadFile], File(alias="files[]", description="One or more PDFs.")],
) -> UploadOut:
    """Upload PDFs (admin). Each is stored and queued for ingestion; duplicates are skipped."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    results: list[UploadItemOut] = []
    for upload in files:
        file_name = upload.filename or "document.pdf"
        try:
            async with service.spool_upload(upload, max_bytes) as spooled:
                document, job = await service.create_document(
                    session,
                    org_id=org.org_id,
                    uploaded_by=actor.id,
                    file_name=file_name,
                    file=spooled,
                )
            results.append(
                UploadItemOut(
                    file_name=file_name, status="queued", document_id=document.id, job_id=job.id
                )
            )
        except service.DuplicateDocument as exc:
            results.append(
                UploadItemOut(
                    file_name=file_name,
                    status="duplicate",
                    document_id=exc.existing_id,
                    message="This PDF has already been uploaded.",
                )
            )
        except service.InvalidUpload as exc:
            results.append(
                UploadItemOut(file_name=file_name, status=exc.reason, message=str(exc))  # type: ignore[arg-type]
            )
        finally:
            await upload.close()

    if not any(item.status == "queued" for item in results):
        first = results[0] if results else None
        if first is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No files were uploaded.")
        raise ApiError(
            FAILURE_STATUS[first.status],
            first.status,
            first.message or "Upload rejected.",
            {
                "existing_id": first.document_id,
                "documents": [item.model_dump(mode="json") for item in results],
            },
        )
    return UploadOut(documents=results)


@router.get("")
async def list_documents(
    org: OrgDep,
    session: SessionDep,
    status_filter: Annotated[
        str | None, Query(alias="status", description=f"One of {', '.join(DOCUMENT_STATUSES)}.")
    ] = None,
    department: str | None = None,
    q: Annotated[str | None, Query(max_length=200, description="Title or doc code.")] = None,
) -> DocumentListOut:
    rows = await service.list_documents(
        session, org.org_id, status=status_filter, department=department, q=q
    )
    return DocumentListOut(
        documents=[
            DocumentOut.model_validate(document).model_copy(
                update={"job": JobOut.model_validate(job) if job else None, "chunk_count": count}
            )
            for document, job, count in rows
        ]
    )


@router.get("/{document_id}")
async def get_document(
    org: OrgDep, session: SessionDep, document_id: uuid.UUID
) -> DocumentDetailOut:
    document = await _document_or_404(session, org.org_id, document_id)
    return await _detail(session, document)


@router.patch("/{document_id}")
async def update_document(
    org: OrgDep,
    _: AdminDep,
    session: SessionDep,
    document_id: uuid.UUID,
    patch: DocumentPatch,
) -> DocumentPatchOut:
    """Edit metadata (admin). Chunk filters update at once; header changes need a reindex."""
    document = await _document_or_404(session, org.org_id, document_id)
    needs_reindex = await service.update_metadata(
        session, document, patch.model_dump(exclude_unset=True)
    )
    detail = await _detail(session, document)
    return DocumentPatchOut(**detail.model_dump(), needs_reindex=needs_reindex)


@router.post("/{document_id}/reindex", status_code=status.HTTP_202_ACCEPTED)
async def reindex_document(
    org: OrgDep, _: AdminDep, session: SessionDep, document_id: uuid.UUID
) -> JobOut:
    """Queue a re-ingestion (admin); returns the active job if one is already queued."""
    document = await _document_or_404(session, org.org_id, document_id)
    return JobOut.model_validate(await service.enqueue_reindex(session, document))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    org: OrgDep, _: AdminDep, session: SessionDep, document_id: uuid.UUID
) -> Response:
    document = await _document_or_404(session, org.org_id, document_id)
    await service.delete_document(session, document)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{document_id}/file",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/pdf": {}}}},
)
async def get_document_file(
    org: OrgDep, session: SessionDep, document_id: uuid.UUID
) -> StreamingResponse:
    """Stream the original PDF (inline, privately cacheable for 5 minutes)."""
    document = await _document_or_404(session, org.org_id, document_id)
    stream = await storage.open_stream(document.file_key)
    file_name = document.file_name or f"{document.id}.pdf"
    ascii_name = file_name.encode("ascii", "ignore").decode().replace('"', "") or "document.pdf"
    headers = {
        "Content-Disposition": (
            f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(file_name)}"
        ),
        "Cache-Control": "private, max-age=300",
    }
    if stream.content_length is not None:
        headers["Content-Length"] = str(stream.content_length)
    return StreamingResponse(stream.iterator, media_type="application/pdf", headers=headers)


@router.get("/{document_id}/job")
async def get_document_job(org: OrgDep, session: SessionDep, document_id: uuid.UUID) -> JobOut:
    """The latest ingestion job, for polling progress."""
    await _document_or_404(session, org.org_id, document_id)
    job = await service.latest_job(session, document_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No ingestion job for this document.")
    return JobOut.model_validate(job)
