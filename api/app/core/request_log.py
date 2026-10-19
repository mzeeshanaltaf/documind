"""Request logs: one `api_request_logs` row per `/v1` request, viewed at `/v1/logs/ui`.

Pure ASGI (like `RequestIdMiddleware`) so SSE and PDF streams pass through unbuffered: request
and response bodies are teed as they flow, capped, and summarised where storing them is
pointless (uploads, PDFs). Chat SSE is condensed into the answer text plus its non-delta events.
Rows are written by background tasks after the response ends; a failed write is only logged.

Code deeper in the stack adds fields with `annotate(...)` (e.g. the chat generator, which runs in
sse-starlette's task group: it copies the context, so it writes into the same per-request dict).
"""

import asyncio
import json
import logging
import re
import time
import traceback
import uuid
from contextvars import ContextVar
from typing import Any

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.log import NO_REQUEST_ID, request_id_var
from app.models.request_log import ApiRequestLog

logger = logging.getLogger(__name__)

LOGGED_PREFIX = "/v1/"
SKIPPED_PREFIX = "/v1/logs"  # the viewer must not log its own polling
REDACTED_HEADERS = frozenset({"x-api-key", "authorization", "cookie", "set-cookie"})
REDACTED = "[REDACTED]"
REQUEST_BODY_CAP = 64 * 1024
RESPONSE_BODY_CAP = 64 * 1024
SSE_BODY_CAP = 256 * 1024
TRACEBACK_CAP = 16 * 1024
UUID_FIELDS = ("conversation_id", "message_id", "document_id")
_FILENAME = re.compile(rb'filename="([^"\r\n]{0,255})"')
_FILENAME_OVERLAP = 512  # bytes kept from the previous chunk so a split part header still matches

_annotations: ContextVar[dict[str, Any] | None] = ContextVar("request_log_fields", default=None)
_pending: set[asyncio.Task[None]] = set()


def annotate(**fields: Any) -> None:
    """Add fields (model column names) to the current request's log row; a no-op outside one."""
    current = _annotations.get()
    if current is not None:
        current.update(fields)


def should_log(path: str) -> bool:
    return path.startswith(LOGGED_PREFIX) and not path.startswith(SKIPPED_PREFIX)


async def drain() -> None:
    """Wait for pending log writes (tests, shutdown)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


def _headers(raw: list[tuple[bytes, bytes]]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in raw:
        name = key.decode("latin-1").lower()
        text = REDACTED if name in REDACTED_HEADERS else value.decode("latin-1")
        out[name] = f"{out[name]}, {text}" if name in out else text
    return out


def route_template(path: str, params: dict[str, Any]) -> str:
    """`/v1/orgs/acme/chat` + {org_id: acme} → `/v1/orgs/{org_id}/chat`. FastAPI ≥0.140 keeps
    included routers nested, so `scope["route"].path` lacks the `/v1` and sub-router prefixes;
    rebuilding from the matched params needs no private API."""
    by_value = {str(value): name for name, value in params.items()}
    return "/".join(
        f"{{{by_value[segment]}}}" if segment in by_value else segment
        for segment in path.split("/")
    )


def _as_uuid(value: Any) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def _decode(data: bytes, *, truncated: bool) -> Any:
    """JSON if the (complete) body parses, else text. jsonb can't hold NUL characters."""
    text = data.decode("utf-8", errors="replace").replace("\x00", "")
    if not truncated:
        try:
            return json.loads(text)
        except ValueError:
            pass
    return text


def condense_sse(raw: bytes) -> dict[str, Any]:
    """`delta` events become one `answer`; every other event keeps its data, in order."""
    answer: list[str] = []
    events: list[dict[str, Any]] = []
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n")
    for block in text.split("\n\n"):
        name, data = None, []
        for line in block.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if not name:
            continue  # pings are comments
        payload = _decode("\n".join(data).encode(), truncated=False) if data else None
        if name == "delta":
            answer.append(payload.get("text", "") if isinstance(payload, dict) else str(payload))
            if events and events[-1]["event"] == "delta":
                events[-1]["count"] += 1
            else:
                events.append({"event": "delta", "count": 1})
            continue
        events.append({"event": name, "data": payload})
    return {"answer": "".join(answer), "events": events}


class _Capture:
    """Everything recorded for one request, filled in as the ASGI messages pass."""

    def __init__(self, scope: Scope) -> None:
        self.scope = scope
        self.started = time.perf_counter()
        self.annotations: dict[str, Any] = {}
        request_headers = Headers(scope=scope)
        self.request_type = request_headers.get("content-type", "")
        self.is_multipart = self.request_type.startswith("multipart/form-data")
        self.request_chunks: list[bytes] = []
        self.request_size = 0
        self.filenames: list[str] = []
        self._filename_tail = b""
        self.status_code: int | None = None
        self.response_headers: dict[str, str] | None = None
        self.response_type = ""
        self.response_chunks: list[bytes] = []
        self.response_size = 0
        self.truncated = False
        self.traceback: str | None = None

    # --- request --------------------------------------------------------------------------

    def add_request(self, chunk: bytes) -> None:
        if not chunk:
            return
        kept = sum(len(c) for c in self.request_chunks)
        self.request_size += len(chunk)
        if self.is_multipart:
            buffer = self._filename_tail + chunk
            for match in _FILENAME.finditer(buffer):
                if match.end() > len(self._filename_tail):
                    self.filenames.append(match.group(1).decode("utf-8", errors="replace"))
            self._filename_tail = buffer[-_FILENAME_OVERLAP:]
        elif kept < REQUEST_BODY_CAP:
            self.request_chunks.append(chunk[: REQUEST_BODY_CAP - kept])

    def request_body(self) -> Any:
        if self.is_multipart:
            return {"multipart": True, "bytes": self.request_size, "filenames": self.filenames}
        if not self.request_size:
            return None
        truncated = self.request_size > REQUEST_BODY_CAP
        self.truncated |= truncated
        return _decode(b"".join(self.request_chunks), truncated=truncated)

    # --- response -------------------------------------------------------------------------

    @property
    def is_sse(self) -> bool:
        return self.response_type.startswith("text/event-stream")

    @property
    def is_text(self) -> bool:
        kind = self.response_type.split(";")[0].strip()
        return kind == "" or kind.startswith("text/") or kind.endswith(("json", "xml"))

    def start_response(self, message: Message) -> None:
        self.status_code = message["status"]
        self.response_headers = _headers(message.get("headers", []))
        self.response_type = self.response_headers.get("content-type", "")

    def add_response(self, chunk: bytes) -> None:
        if not chunk:
            return
        self.response_size += len(chunk)
        if not self.is_text:
            return
        cap = SSE_BODY_CAP if self.is_sse else RESPONSE_BODY_CAP
        kept = sum(len(c) for c in self.response_chunks)
        if kept < cap:
            self.response_chunks.append(chunk[: cap - kept])

    def response_body(self) -> Any:
        if not self.response_size:
            return None
        if not self.is_text:
            return {"content_type": self.response_type or None, "bytes": self.response_size}
        cap = SSE_BODY_CAP if self.is_sse else RESPONSE_BODY_CAP
        truncated = self.response_size > cap
        self.truncated |= truncated
        raw = b"".join(self.response_chunks)
        return condense_sse(raw) if self.is_sse else _decode(raw, truncated=truncated)

    # --- the row --------------------------------------------------------------------------

    def fail(self) -> None:
        self.traceback = traceback.format_exc()[-TRACEBACK_CAP:]

    def row(self) -> dict[str, Any]:
        scope = self.scope
        headers = Headers(scope=scope)
        params = scope.get("path_params") or {}
        matched = scope.get("route") is not None  # unset when no route matched (404)
        request_id = request_id_var.get()
        response_body = self.response_body()
        row: dict[str, Any] = {
            "request_id": None if request_id == NO_REQUEST_ID else request_id,
            "method": scope["method"],
            "path": scope["path"],
            "query": scope.get("query_string", b"").decode("latin-1") or None,
            "route": route_template(scope["path"], params) if matched else None,
            # No response started means an unhandled exception: ServerErrorMiddleware sends 500.
            "status_code": self.status_code or 500,
            "duration_ms": round((time.perf_counter() - self.started) * 1000),
            "user_id": headers.get("x-user-id"),
            "org_id": params.get("org_id"),
            "conversation_id": params.get("conversation_id"),
            "message_id": params.get("message_id"),
            "document_id": params.get("document_id"),
            "client_ip": (scope.get("client") or (None,))[0],
            "user_agent": headers.get("user-agent"),
            "request_headers": _headers(scope.get("headers", [])),
            "request_body": self.request_body(),
            "request_body_size": self.request_size,
            "response_headers": self.response_headers,
            "response_body": response_body,
            "response_content_type": self.response_type or None,
            "response_body_size": self.response_size,
            "error_traceback": self.traceback,
        }
        error = response_body.get("error") if isinstance(response_body, dict) else None
        if isinstance(error, dict):
            row["error_code"], row["error_message"] = error.get("code"), error.get("message")
        elif self.status_code is None:
            row["error_code"], row["error_message"] = "internal_error", "Unhandled exception."
        elif self.is_sse and isinstance(response_body, dict):
            # A 200 stream can still end in an `error` event.
            failed = [e for e in response_body["events"] if e["event"] == "error"]
            if failed:
                data = failed[-1].get("data")
                row["error_code"] = "stream_error"
                row["error_message"] = data.get("message") if isinstance(data, dict) else data
        row.update(self.annotations)
        row["body_truncated"] = self.truncated
        for name in UUID_FIELDS:
            row[name] = _as_uuid(row[name])
        return row


async def _write(row: dict[str, Any]) -> None:
    try:
        async with session_scope() as session:
            session.add(ApiRequestLog(**row))
    except Exception:
        logger.exception("Failed to write the request log for %s %s", row["method"], row["path"])


class RequestLogMiddleware:
    """Add it *inside* `RequestIdMiddleware` (i.e. add_middleware it first) so the request id
    is set by the time a row is built."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or not should_log(scope["path"])
            or not get_settings().request_log_enabled
        ):
            await self.app(scope, receive, send)
            return

        capture = _Capture(scope)
        token = _annotations.set(capture.annotations)

        async def receive_teed() -> Message:
            message = await receive()
            if message["type"] == "http.request":
                capture.add_request(message.get("body", b""))
            return message

        async def send_teed(message: Message) -> None:
            if message["type"] == "http.response.start":
                capture.start_response(message)
            elif message["type"] == "http.response.body":
                capture.add_response(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive_teed, send_teed)
        except Exception:
            capture.fail()
            raise
        finally:
            _annotations.reset(token)
            try:
                row = capture.row()
            except Exception:
                logger.exception("Could not build the request log for %s", scope["path"])
            else:
                task = asyncio.create_task(_write(row))
                _pending.add(task)
                task.add_done_callback(_pending.discard)
