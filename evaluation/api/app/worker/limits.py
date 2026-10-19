"""Process-wide concurrency limits shared by every worker slot: DocuMind calls, and Anthropic
calls (a semaphore per judge model + one requests-per-minute token bucket)."""

import asyncio
import time
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


class TokenBucket:
    """`rate_per_minute` requests per minute, bursting up to that many. `acquire()` waits for a
    token."""

    def __init__(self, rate_per_minute: int) -> None:
        self.capacity = float(max(1, rate_per_minute))
        self.per_second = self.capacity / 60
        self._tokens = self.capacity
        self._updated = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.per_second)
        self._updated = now

    async def acquire(self) -> None:
        async with self._lock:
            self._refill()
            while self._tokens < 1:
                await asyncio.sleep((1 - self._tokens) / self.per_second)
                self._refill()
            self._tokens -= 1


class JudgeLimiter:
    """`async with judge_limiter().slot(model):` holds one of the model's
    `EVAL_JUDGE_CONCURRENCY` slots, after taking an RPM token (`EVAL_ANTHROPIC_MAX_RPM`)."""

    def __init__(self, concurrency: int, rpm: int) -> None:
        self.concurrency = concurrency
        self.bucket = TokenBucket(rpm)
        self._models: dict[str, Limiter] = {}

    def _limiter(self, model: str) -> Limiter:
        if model not in self._models:
            self._models[model] = Limiter(self.concurrency)
        return self._models[model]

    def slot(self, model: str) -> "_JudgeSlot":
        return _JudgeSlot(self._limiter(model), self.bucket)


class _JudgeSlot:
    def __init__(self, limiter: Limiter, bucket: TokenBucket) -> None:
        self.limiter, self.bucket = limiter, bucket

    async def __aenter__(self) -> None:
        await self.limiter.__aenter__()
        try:
            await self.bucket.acquire()
        except BaseException:
            await self.limiter.__aexit__(None, None, None)
            raise

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.limiter.__aexit__(exc_type, exc, tb)


@lru_cache
def judge_limiter() -> JudgeLimiter:
    settings = get_settings()
    return JudgeLimiter(settings.eval_judge_concurrency, settings.eval_anthropic_max_rpm)
