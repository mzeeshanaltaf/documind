"""Logging setup and request-id middleware."""

import logging
import logging.config
import re
import time
import uuid
from contextvars import ContextVar

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
QUIET_PATHS = frozenset({"/health"})  # polled by Coolify's healthcheck

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
logger = logging.getLogger("app.request")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


_configured = False


def configure_logging(level: str = "INFO") -> None:
    """Configure stdlib logging once; uvicorn's own loggers are left in place."""
    global _configured
    if _configured:
        return
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "filters": {"request_id": {"()": RequestIdFilter}},
            "formatters": {
                "default": {
                    "format": "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"
                }
            },
            "handlers": {
                "stdout": {
                    "class": "logging.StreamHandler",
                    "stream": "ext://sys.stdout",
                    "formatter": "default",
                    "filters": ["request_id"],
                }
            },
            "loggers": {"app": {"level": level, "handlers": ["stdout"], "propagate": False}},
        }
    )
    _configured = True


class RequestIdMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so SSE and file streams pass through unbuffered.

    Reuses a well-formed incoming X-Request-ID (e.g. from the BFF) or mints one, exposes it to
    log records, echoes it on the response and logs one line per request.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get(REQUEST_ID_HEADER)
        is_valid = incoming is not None and _VALID_REQUEST_ID.match(incoming)
        request_id = incoming if is_valid else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_with_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message).append(REQUEST_ID_HEADER, request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            if scope["path"] not in QUIET_PATHS:
                elapsed_ms = (time.perf_counter() - started) * 1000
                logger.info(
                    "%s %s %s %.0fms", scope["method"], scope["path"], status_code, elapsed_ms
                )
            request_id_var.reset(token)
