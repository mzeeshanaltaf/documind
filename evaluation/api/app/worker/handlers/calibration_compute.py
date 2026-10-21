"""Recompute every judge calibration from the reviews (E9). Review submits enqueue it
debounced (`services/review.schedule_compute`); it holds an advisory lock, so two at once just
run one after the other."""

import logging

from app.core.db import session_scope
from app.services import calibration
from app.worker.queue import ClaimedJob

logger = logging.getLogger(__name__)


async def handle(job: ClaimedJob) -> None:
    async with session_scope() as session:
        groups = await calibration.compute(session)
    logger.info("calibration_compute %s: %d group(s)", job.id, groups)
