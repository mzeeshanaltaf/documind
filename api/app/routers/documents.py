"""Documents API under /v1/orgs/{org_id}/documents: upload, list, metadata, file, reindex.

Filled in Phase 4.
"""

from fastapi import APIRouter

router = APIRouter(tags=["documents"])
