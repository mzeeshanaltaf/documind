"""A handler that does nothing but wait (tests and the restart drill).

Payload: `{"sleep_s": float = 0, "error": str | None}`. With `error` it raises, so retries and
backoff can be exercised.
"""

import asyncio
import logging

from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)


async def handle(job: ClaimedJob) -> None:
    sleep_s = float(job.payload.get("sleep_s", 0))
    logger.info("noop job %s: attempt %d, sleeping %.1f s", job.id, job.attempts, sleep_s)
    await asyncio.sleep(sleep_s)
    if error := job.payload.get("error"):
        raise RuntimeError(str(error))
    logger.info("noop job %s: done", job.id)
