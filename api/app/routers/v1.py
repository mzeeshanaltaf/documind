from fastapi import APIRouter, Depends

from app.core.security import verify_api_key
from app.routers import analytics, chat, conversations, documents, me, settings

# Every /v1 route requires the service key; routes add get_actor / require_* as needed.
router = APIRouter(prefix="/v1", dependencies=[Depends(verify_api_key)])

for module in (me, documents, chat, conversations, settings, analytics):
    router.include_router(module.router)
