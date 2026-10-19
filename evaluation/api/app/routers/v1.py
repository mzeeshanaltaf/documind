from fastapi import APIRouter, Depends

from app.core.security import get_admin
from app.routers import datasets, documind, jobs, prompts, runs

# Every /v1 route needs the service key and a DocuMind platform admin as X-User-Id
# (FastAPI resolves get_admin once per request, also for routes that take AdminDep).
router = APIRouter(prefix="/v1", dependencies=[Depends(get_admin)])

for module in (datasets, documind, jobs, prompts, runs):
    router.include_router(module.router)
