"""DocuMind passthrough for the eval web (org pickers, document lists, config fingerprint)."""

from typing import Any

from fastapi import APIRouter

from app.core.security import AdminDep
from app.documind.client import get_documind
from app.documind.models import Document, OrgAccess

router = APIRouter(prefix="/documind", tags=["documind"])


@router.get("/orgs")
async def orgs(_: AdminDep) -> list[OrgAccess]:
    """The orgs the eval service account sees (from DocuMind's `/v1/me`)."""
    return (await get_documind().me()).orgs


@router.get("/orgs/{org_id}/documents")
async def documents(_: AdminDep, org_id: str) -> list[Document]:
    return await get_documind().documents(org_id)


@router.get("/info")
async def info(_: AdminDep) -> dict[str, Any]:
    """DocuMind's `/admin/eval/info`: version, defaults, models, prompt and pricing hashes."""
    return await get_documind().info()
