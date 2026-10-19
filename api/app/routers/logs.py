"""Request logs: the key-gated read API (`router`, under /v1) and the viewer page (`ui_router`).

The page is a public, data-free HTML shell: it asks for the service API key and sends it as
`X-API-Key` on every data call. `ui_router` must be included before `v1.router`, or
`/v1/logs/{log_id}` would claim `/v1/logs/ui`.
"""

import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.core.security import SessionDep
from app.schemas.request_logs import LogDetailOut, LogListOut, LogRoutesOut
from app.services import request_logs as service

router = APIRouter(prefix="/logs", tags=["logs"])
ui_router = APIRouter(include_in_schema=False)

_UI_HTML = (Path(__file__).resolve().parents[1] / "static" / "logs_ui.html").read_text("utf-8")
NONCE_PLACEHOLDER = "__CSP_NONCE__"


@router.get("")
async def list_logs(
    session: SessionDep,
    q: Annotated[
        str | None, Query(max_length=200, description="Path/query/error text, or a request/log id.")
    ] = None,
    method: Annotated[str | None, Query(max_length=10)] = None,
    status: Annotated[
        str | None, Query(max_length=3, description="2xx|3xx|4xx|5xx or a code.")
    ] = None,
    route: Annotated[str | None, Query(max_length=300)] = None,
    user_id: Annotated[str | None, Query(max_length=200)] = None,
    org_id: Annotated[str | None, Query(max_length=200)] = None,
    since: Annotated[datetime | None, Query(alias="from")] = None,
    until: Annotated[datetime | None, Query(alias="to")] = None,
    before: Annotated[str | None, Query(max_length=100, description="`next_cursor`.")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> LogListOut:
    """Logged `/v1` requests, newest first, with their user, org and LLM token/cost totals."""
    return await service.list_logs(
        session,
        q=q,
        method=method,
        status=status,
        route=route,
        user_id=user_id,
        org_id=org_id,
        since=since,
        until=until,
        before=before,
        limit=limit,
    )


@router.get("/routes")
async def list_routes(session: SessionDep) -> LogRoutesOut:
    """Distinct route templates seen in the logs (for the viewer's filter)."""
    return LogRoutesOut(routes=await service.list_routes(session))


@router.get("/{log_id}")
async def get_log(session: SessionDep, log_id: uuid.UUID) -> LogDetailOut:
    """One request in full: bodies, error, LLM calls and, for chat, the answer's retrieval."""
    return await service.get_log(session, log_id)


@ui_router.get("/v1/logs/ui")
async def logs_ui() -> HTMLResponse:
    nonce = secrets.token_urlsafe(16)
    return HTMLResponse(
        _UI_HTML.replace(NONCE_PLACEHOLDER, nonce),
        headers={
            "Content-Security-Policy": (
                "default-src 'none'; "
                f"script-src 'nonce-{nonce}'; "
                "style-src 'unsafe-inline'; "
                "connect-src 'self'; "
                "img-src data:; "
                "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            ),
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
        },
    )
