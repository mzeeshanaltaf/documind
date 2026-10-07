"""Chat API: POST /v1/orgs/{org_id}/chat (SSE). Filled in Phase 5."""

from fastapi import APIRouter

router = APIRouter(tags=["chat"])
