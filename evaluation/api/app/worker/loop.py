"""Worker slots: `EVAL_WORKER_SLOTS` asyncio tasks in the API process, each looping
claim → dispatch to `HANDLERS[kind]` → record the outcome.

On shutdown the slots are cancelled and an in-flight job is released (queued again, attempt
refunded). A hard kill skips that; the job's lock then expires and it is reclaimed.
"""

import asyncio
import contextlib
import logging
import os
import random
import socket
import traceback

from app.core.log import request_id_var
from app.worker import queue
from app.worker.errors import PermanentJobError, RetryLater
from app.worker.handlers import HANDLERS
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)

IDLE_POLL_S = 1.0
IDLE_JITTER_S = 0.5


def worker_id(slot: int) -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{slot}"


async def _idle(stop: asyncio.Event) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), IDLE_POLL_S + random.uniform(0, IDLE_JITTER_S))


async def _heartbeat(job: ClaimedJob) -> None:
    while True:
        await asyncio.sleep(queue.HEARTBEAT_EVERY_S)
        try:
            if not await queue.heartbeat(job):
                logger.warning("Lost the lock on job %s (reclaimed elsewhere)", job.id)
                return
        except Exception:
            logger.exception("Heartbeat failed for job %s", job.id)


async def process(job: ClaimedJob) -> None:
    """Run one claimed job and record what happened."""
    token = request_id_var.set(f"job.{job.kind}.{job.id.hex[:8]}.{job.attempts}")
    try:
        handler = HANDLERS.get(job.kind)
        if handler is None:
            await queue.fail(job, f"No handler for kind {job.kind!r}", retry=False)
            return
        if job.attempts > job.max_attempts:
            # Only a reclaimed job gets here: it kept dying without recording an outcome.
            await queue.fail(job, "Gave up: the job's lock expired too many times", retry=False)
            return

        beat = asyncio.create_task(_heartbeat(job), name=f"heartbeat-{job.id}")
        try:
            await handler(job)
        except asyncio.CancelledError:
            await queue.release(job)
            logger.info("Released job %s on shutdown", job.id)
            raise
        except RetryLater as exc:
            await queue.requeue(job, exc.delay)
        except PermanentJobError as exc:
            logger.warning("Job %s failed permanently: %s", job.id, exc)
            await queue.fail(job, str(exc), retry=False)
        except Exception as exc:
            logger.exception("Job %s (%s) failed on attempt %d", job.id, job.kind, job.attempts)
            await queue.fail(job, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")
        else:
            await queue.succeed(job)
        finally:
            beat.cancel()
    finally:
        request_id_var.reset(token)


async def run_slot(slot: int, stop: asyncio.Event) -> None:
    wid = worker_id(slot)
    while not stop.is_set():
        try:
            job = await queue.claim(wid)
        except Exception:
            logger.exception("Claim failed (slot %d)", slot)
            await _idle(stop)
            continue
        if job is None:
            await _idle(stop)
            continue
        try:
            await process(job)
        except Exception:
            # Recording the outcome failed (e.g. a DB blip); the lock expires and it's reclaimed.
            logger.exception("Could not record the outcome of job %s", job.id)


def start_slots(count: int, stop: asyncio.Event) -> list[asyncio.Task[None]]:
    return [
        asyncio.create_task(run_slot(slot, stop), name=f"eval-worker-{slot}")
        for slot in range(count)
    ]


async def stop_slots(tasks: list[asyncio.Task[None]], stop: asyncio.Event) -> None:
    """Idle slots exit on `stop`; busy ones are cancelled, which releases their job."""
    stop.set()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
