"""Job kind → handler. A handler opens its own sessions (an AsyncSession isn't concurrency-safe,
and slots run concurrently) and signals outcomes by returning, or by raising one of the errors
in `app.worker.errors`."""

from collections.abc import Awaitable, Callable

from app.worker.handlers import noop
from app.worker.queue import ClaimedJob

Handler = Callable[[ClaimedJob], Awaitable[None]]

HANDLERS: dict[str, Handler] = {
    "noop": noop.handle,
}
