from fastapi import APIRouter, Depends

from app.core.security import get_admin
from app.routers import (
    calibration,
    compare,
    datasets,
    documind,
    jobs,
    prompts,
    review,
    runs,
    synthetic,
    system,
    trends,
)

# Every /v1 route needs the service key and a DocuMind platform admin as X-User-Id
# (FastAPI resolves get_admin once per request, also for routes that take AdminDep).
router = APIRouter(prefix="/v1", dependencies=[Depends(get_admin)])

for module in (
    calibration, compare, datasets, documind, jobs, prompts, review, runs, synthetic, system, trends
):  # fmt: skip
    router.include_router(module.router)
