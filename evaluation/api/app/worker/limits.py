"""Process-wide concurrency limits shared by every worker slot. The judge limiters (per-model
semaphores + an RPM token bucket) arrive in E4."""

import asyncio
from functools import lru_cache
from types import TracebackType

from app.core.config import get_settings


class Limiter:
    """An async context manager over a semaphore, with its size exposed for diagnostics."""

    def __init__(self, limit: int) -> None:
        self.limit = max(1, limit)
        self._semaphore = asyncio.Semaphore(self.limit)

    async def __aenter__(self) -> None:
        await self._semaphore.acquire()

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self._semaphore.release()


class DocuMindLimiter(Limiter):
    """Caps concurrent DocuMind calls (`EVAL_DOCUMIND_CONCURRENCY`): prod DocuMind serves real
    users on one uvicorn worker."""


@lru_cache
def documind_limiter() -> DocuMindLimiter:
    return DocuMindLimiter(get_settings().eval_documind_concurrency)
