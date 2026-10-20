"""The only way the harness talks to DocuMind: `/v1` over HTTP as the `eval-bot` service admin.

Every call can carry the eval tags (`X-Eval-Run-Id`, `X-Eval-Case-Id`) and a request id
(`X-Request-ID`, `^[A-Za-z0-9._-]{1,128}$`, so `eval.<run8>.<case_key>.<attempt>`, no colons).
GETs (and the idempotent cleanup DELETE) retry on 5xx and connection errors; POSTs never do,
because a chat or a retrieval is metered (and a chat creates a conversation) on every attempt.
"""

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx
from httpx_sse import aconnect_sse

from app.core.config import get_settings
from app.documind.events import ChatEvent, parse_event
from app.documind.models import ChunkPage, Document, Health, Me, Mode, RetrieveResult

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
CHAT_TIMEOUT_S = 180.0  # whole turn; DocuMind pings every 15 s, so reads never sit idle that long
GET_RETRIES = 2  # extra attempts after the first, for GETs only
RETRY_STATUSES = frozenset({500, 502, 503, 504})


class DocuMindError(Exception):
    """A failed DocuMind call. `status_code` is None for connection errors and timeouts."""

    def __init__(
        self,
        status_code: int | None,
        code: str,
        message: str,
        details: Any = None,
    ) -> None:
        super().__init__(f"DocuMind {status_code or 'unreachable'} {code}: {message}")
        self.status_code, self.code, self.message, self.details = (
            status_code,
            code,
            message,
            details,
        )

    @property
    def retryable(self) -> bool:
        """429, 5xx and transport failures are worth a later retry; other 4xx are permanent."""
        return self.status_code is None or self.status_code == 429 or self.status_code >= 500


def error_from_response(response: httpx.Response) -> DocuMindError:
    """DocuMind's errors are `{"error": {"code", "message"[, "details"]}}`."""
    try:
        error = response.json().get("error") or {}
    except ValueError:
        error = {}
    return DocuMindError(
        response.status_code,
        error.get("code") or f"http_{response.status_code}",
        error.get("message") or response.reason_phrase or "Request failed.",
        error.get("details"),
    )


class DocuMindClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        user_id: str | None = None,
        *,
        retry_backoff_s: float = 0.5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        settings = get_settings()
        user_id = user_id or settings.eval_service_user_id
        headers = {"X-API-Key": api_key or settings.documind_api_key}
        if user_id:
            headers["X-User-Id"] = user_id
        self.retry_backoff_s = retry_backoff_s
        self._http = httpx.AsyncClient(
            base_url=(base_url or settings.documind_api_url).rstrip("/"),
            headers=headers,
            timeout=DEFAULT_TIMEOUT,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "DocuMindClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    # --- plumbing --------------------------------------------------------------------------

    @staticmethod
    def tag_headers(
        eval_run_id: str | None = None,
        eval_case_id: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, str]:
        headers = {}
        if eval_run_id:
            headers["X-Eval-Run-Id"] = eval_run_id
        if eval_case_id:
            headers["X-Eval-Case-Id"] = eval_case_id
        if request_id:
            headers["X-Request-ID"] = request_id
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        retry: bool,
        params: dict[str, Any] | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        attempts = 1 + (GET_RETRIES if retry else 0)
        for attempt in range(attempts):
            last = attempt == attempts - 1
            try:
                response = await self._http.request(
                    method, path, params=params, json=json, headers=headers
                )
            except httpx.TransportError as exc:
                if last:
                    message = f"{type(exc).__name__}: {exc}"
                    raise DocuMindError(None, "unreachable", message) from exc
                logger.warning("DocuMind %s %s failed (%s); retrying", method, path, exc)
            else:
                if response.is_success:
                    return response.json() if response.content else None
                if last or response.status_code not in RETRY_STATUSES:
                    raise error_from_response(response)
                logger.warning("DocuMind %s %s → %d; retrying", method, path, response.status_code)
            await asyncio.sleep(self.retry_backoff_s * 2**attempt)
        raise AssertionError("unreachable")  # pragma: no cover

    async def _get(self, path: str, params: dict[str, Any] | None = None, **tags: Any) -> Any:
        return await self._request(
            "GET", path, retry=True, params=params, headers=self.tag_headers(**tags)
        )

    # --- reads -----------------------------------------------------------------------------

    async def health(self) -> Health:
        return Health.model_validate(await self._get("/health"))

    async def me(self, **tags: Any) -> Me:
        return Me.model_validate(await self._get("/v1/me", **tags))

    async def documents(self, org_id: str, **tags: Any) -> list[Document]:
        data = await self._get(f"/v1/orgs/{org_id}/documents", **tags)
        return [Document.model_validate(item) for item in data["documents"]]

    async def chunks(
        self, org_id: str, doc_id: str, offset: int = 0, limit: int = 500, **tags: Any
    ) -> ChunkPage:
        data = await self._get(
            f"/v1/orgs/{org_id}/documents/{doc_id}/chunks",
            {"offset": offset, "limit": limit},
            **tags,
        )
        return ChunkPage.model_validate(data)

    async def info(self, **tags: Any) -> dict[str, Any]:
        """`/admin/eval/info`: version, defaults, models, prompt hashes, retrieval constants."""
        return await self._get("/v1/admin/eval/info", **tags)

    async def conversation(self, conversation_id: str | uuid.UUID, **tags: Any) -> dict[str, Any]:
        return await self._get(f"/v1/conversations/{conversation_id}", **tags)

    async def run_usage(self, run_id: str, **tags: Any) -> dict[str, Any]:
        return await self._get(f"/v1/admin/eval-runs/{run_id}/usage", **tags)

    async def run_conversations(
        self, run_id: str, case_id: str | None = None, **tags: Any
    ) -> list[dict[str, Any]]:
        """The run's eval conversations (oldest first), optionally one case's."""
        params = {"case_id": case_id} if case_id else None
        data = await self._get(f"/v1/admin/eval-runs/{run_id}/conversations", params, **tags)
        return list(data["conversations"])

    async def org_settings(self, org_id: str, **tags: Any) -> dict[str, Any]:
        """Effective chat/router models, tier and top_k (env defaults fill unset fields)."""
        return await self._get(f"/v1/orgs/{org_id}/settings", **tags)

    # --- writes ----------------------------------------------------------------------------

    async def delete_conversation(self, conversation_id: str | uuid.UUID, **tags: Any) -> bool:
        """False when it was already gone (404), so a retry is harmless."""
        try:
            await self._request(
                "DELETE",
                f"/v1/conversations/{conversation_id}",
                retry=True,
                headers=self.tag_headers(**tags),
            )
        except DocuMindError as exc:
            if exc.status_code == 404:
                return False
            raise
        return True

    async def upload_document(self, org_id: str, file_name: str, content: bytes) -> dict[str, Any]:
        """Upload one PDF (admin); DocuMind queues it for ingestion. A duplicate is a 409 whose
        details hold the existing id. Never retried."""
        response = await self._http.post(
            f"/v1/orgs/{org_id}/documents",
            files={"files[]": (file_name, content, "application/pdf")},
            timeout=httpx.Timeout(120.0, connect=10.0),
        )
        if not response.is_success:
            raise error_from_response(response)
        return response.json()

    async def delete_run_conversations(self, run_id: str, **tags: Any) -> int:
        """Idempotent (a second call deletes 0), so it retries like a GET."""
        data = await self._request(
            "DELETE",
            f"/v1/admin/eval-runs/{run_id}/conversations",
            retry=True,
            headers=self.tag_headers(**tags),
        )
        return int(data["deleted"])

    async def retrieve(
        self,
        org_id: str,
        query: str,
        *,
        modes: Sequence[Mode] = ("hybrid",),
        history: Sequence[dict[str, str]] | None = None,
        document_ids: Sequence[str] | None = None,
        top_k: int | None = None,
        router_model: str | None = None,
        chat_service_tier: str | None = None,
        eval_run_id: str | None = None,
        eval_case_id: str | None = None,
        request_id: str | None = None,
    ) -> RetrieveResult:
        body: dict[str, Any] = {"query": query, "modes": list(modes)}
        optional = {
            "history": list(history) if history else None,
            "document_ids": list(document_ids) if document_ids else None,
            "top_k": top_k,
            "router_model": router_model,
            "chat_service_tier": chat_service_tier,
        }
        body.update({key: value for key, value in optional.items() if value is not None})
        data = await self._request(
            "POST",
            f"/v1/orgs/{org_id}/retrieve",
            retry=False,
            json=body,
            headers=self.tag_headers(eval_run_id, eval_case_id, request_id),
        )
        return RetrieveResult.model_validate(data)

    async def chat(
        self,
        org_id: str,
        message: str,
        *,
        conversation_id: str | uuid.UUID | None = None,
        document_ids: Sequence[str] | None = None,
        overrides: dict[str, Any] | None = None,
        eval_run_id: str | None = None,
        eval_case_id: str | None = None,
        request_id: str | None = None,
    ) -> AsyncIterator[ChatEvent]:
        """Stream one chat turn as typed events (keep-alive pings are skipped). Never retried.
        Use it under `contextlib.aclosing` so an abandoned stream closes its connection."""
        body: dict[str, Any] = {"message": message}
        if conversation_id:
            body["conversation_id"] = str(conversation_id)
        if document_ids:
            body["document_ids"] = list(document_ids)
        if overrides:
            body["overrides"] = overrides
        headers = {
            "Accept": "text/event-stream",
            **self.tag_headers(eval_run_id, eval_case_id, request_id),
        }
        deadline = time.monotonic() + CHAT_TIMEOUT_S
        try:
            async with aconnect_sse(
                self._http,
                "POST",
                f"/v1/orgs/{org_id}/chat",
                json=body,
                headers=headers,
                timeout=httpx.Timeout(CHAT_TIMEOUT_S, connect=10.0),
            ) as source:
                if not source.response.is_success:
                    await source.response.aread()
                    raise error_from_response(source.response)
                async for sse in source.aiter_sse():
                    if not sse.data and sse.event in ("", "message"):
                        continue  # a comment-only frame (": ping")
                    yield parse_event(sse.event, sse.data or "{}")
                    if time.monotonic() > deadline:
                        raise DocuMindError(
                            None, "timeout", f"Chat turn exceeded {CHAT_TIMEOUT_S:.0f} s."
                        )
        except httpx.TimeoutException as exc:
            raise DocuMindError(None, "timeout", f"{type(exc).__name__}: {exc}") from exc
        except httpx.TransportError as exc:
            raise DocuMindError(None, "unreachable", f"{type(exc).__name__}: {exc}") from exc

    async def probe(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, str | None]:
        """One raw request for the authz probes (E8): its status and DocuMind's error code. A
        success body is never read (a chat would stream), only closed. Transport failures raise
        `DocuMindError` (status None); nothing is retried."""
        try:
            async with self._http.stream(method, path, json=json, headers=headers) as response:
                if response.is_success:
                    return response.status_code, None
                await response.aread()
                return response.status_code, error_from_response(response).code
        except httpx.TimeoutException as exc:
            raise DocuMindError(None, "timeout", f"{type(exc).__name__}: {exc}") from exc
        except httpx.TransportError as exc:
            raise DocuMindError(None, "unreachable", f"{type(exc).__name__}: {exc}") from exc


_client: DocuMindClient | None = None


def get_documind() -> DocuMindClient:
    """The process-wide client (one connection pool); closed by the app lifespan."""
    global _client
    if _client is None:
        _client = DocuMindClient()
    return _client


async def close_documind() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
