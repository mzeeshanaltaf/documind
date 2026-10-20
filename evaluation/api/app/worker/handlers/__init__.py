"""Job kind → handler. A handler opens its own sessions (an AsyncSession isn't concurrency-safe,
and slots run concurrently) and signals outcomes by returning, or by raising one of the errors
in `app.worker.errors`."""

from collections.abc import Awaitable, Callable

from app.worker.handlers import (
    case_generate,
    case_judge,
    noop,
    run_finalize,
    synthetic_generate,
)
from app.worker.queue import ClaimedJob

Handler = Callable[[ClaimedJob], Awaitable[None]]

HANDLERS: dict[str, Handler] = {
    "noop": noop.handle,
    "case_generate": case_generate.handle,
    "case_judge": case_judge.handle,
    "run_finalize": run_finalize.handle,
    "synthetic_generate": synthetic_generate.handle,
}
