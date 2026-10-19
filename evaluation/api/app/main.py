import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.db import engine, session_scope
from app.core.errors import error_body, install_exception_handlers
from app.core.log import RequestIdMiddleware, configure_logging
from app.documind.client import DocuMindError, close_documind
from app.judge import registry
from app.routers import health, v1
from app.worker import loop
from app.worker.sweeper import start_sweeper

configure_logging()
logger = logging.getLogger("app.main")


async def sync_prompts() -> None:
    """Register the judge prompt files' current versions. A failure is logged, not fatal: runs
    sync again when they are created."""
    try:
        async with session_scope() as session:
            refs = await registry.sync(session)
        logger.info(
            "Judge prompts: %s",
            ", ".join(f"{key} v{ref['version']}" for key, ref in sorted(refs.items())),
        )
    except Exception:
        logger.exception("Judge prompt sync failed")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await sync_prompts()
    stop = asyncio.Event()
    slots = loop.start_slots(get_settings().eval_worker_slots, stop)
    # The sweeper settles runs whose in-flight cases died; pointless without workers.
    sweeper = [start_sweeper(stop)] if slots else []
    logger.info("Started %d worker slot(s)", len(slots))
    yield
    # Busy slots are cancelled and release their job (queued again, attempt refunded).
    await loop.stop_slots([*slots, *sweeper], stop)
    await close_documind()
    await engine.dispose()


app = FastAPI(
    title="DocuMind Evaluation API",
    version="0.1.0",
    description=(
        "Datasets, durable evaluation runs, metrics and judging for DocuMind. Internal only: "
        "every `/v1` route needs `X-API-Key` and a DocuMind platform admin as `X-User-Id`."
    ),
    lifespan=lifespan,
)
# No CORS: only the eval web's BFF calls this API, server to server.
app.add_middleware(RequestIdMiddleware)
install_exception_handlers(app)


@app.exception_handler(DocuMindError)
async def documind_error_handler(_: Request, exc: DocuMindError) -> JSONResponse:
    """DocuMind's 4xx keep their status (a 404 org stays a 404); outages become 502."""
    status_code = exc.status_code if exc.status_code and exc.status_code < 500 else 502
    details = {"status": exc.status_code, "code": exc.code, "details": exc.details}
    return JSONResponse(
        error_body(f"documind_{exc.code}", exc.message, details), status_code=status_code
    )


app.include_router(health.router)
app.include_router(v1.router)
