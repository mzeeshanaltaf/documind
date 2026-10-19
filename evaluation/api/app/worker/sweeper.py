"""A background task that runs `run_state.sweep()` every few seconds: settles pausing/stopping
runs whose in-flight cases died, errors out cases whose job failed without an outcome, and fails
runs stuck in `finalizing`. Started by the app lifespan next to the worker slots."""

import asyncio
import contextlib
import logging

from app.services import run_state

logger = logging.getLogger(__name__)

SWEEP_EVERY_S = 15.0


async def run_sweeper(stop: asyncio.Event) -> None:
    while not stop.is_set():
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), SWEEP_EVERY_S)
        if stop.is_set():
            return
        try:
            await run_state.sweep()
        except Exception:
            logger.exception("Run sweep failed")


def start_sweeper(stop: asyncio.Event) -> asyncio.Task[None]:
    return asyncio.create_task(run_sweeper(stop), name="eval-run-sweeper")
