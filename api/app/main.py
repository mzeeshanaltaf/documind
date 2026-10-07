import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core import storage
from app.core.config import get_settings
from app.core.db import engine
from app.core.errors import install_exception_handlers
from app.core.log import RequestIdMiddleware, configure_logging
from app.ingestion import worker
from app.routers import health, v1

configure_logging()
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        await storage.ensure_bucket()
    except Exception:
        # Chat and metadata still work without storage; uploads/file streams will fail loudly.
        logger.exception("Storage bucket check failed; continuing without it")

    stop = asyncio.Event()
    workers = [
        asyncio.create_task(worker.run(stop), name=f"ingest-worker-{i}")
        for i in range(max(1, get_settings().ingest_concurrency))
    ]
    logger.info("Started %d ingestion worker(s)", len(workers))
    yield
    stop.set()
    # An in-flight job is interrupted; its lock expires and another worker reclaims it.
    _, pending = await asyncio.wait(workers, timeout=5)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    await engine.dispose()


app = FastAPI(
    title="DocuMind API",
    version="0.1.0",
    description=(
        "Ingestion, hybrid retrieval and agentic chat over company documents. "
        "All `/v1` routes need `X-API-Key`; most also need `X-User-Id`."
    ),
    lifespan=lifespan,
)
# No CORS: the API is called server-to-server (Next.js BFF) or by API-key holders.
app.add_middleware(RequestIdMiddleware)
install_exception_handlers(app)

app.include_router(health.router)
app.include_router(v1.router)
