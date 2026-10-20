"""Authz probes (E8): an `authz_probe` case lists requests that the probe user (a plain member of
the run's org, `EVAL_PROBE_USER_ID`) sends to DocuMind, each with the status it must get back:
another org's chat → 404, the service account's conversation → 404, eval headers or chat
`overrides` → 403, `/retrieve` and `/chunks` → 403, and so on.

The pure parts live here (placeholders, outcome of one request); the handler
(`worker/handlers/authz_probe.py`) resolves the run's values and sends the requests.
"""

import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.schemas.datasets import PLACEHOLDER_RE, ProbeRequest


class ProbeSetupError(Exception):
    """The run can't probe (no probe user, no canary org, …): a case error, not a failed probe."""


def needed_placeholders(requests: Iterable[ProbeRequest]) -> set[str]:
    return {name for request in requests for name in request.placeholders}


def resolve_path(path: str, values: Mapping[str, str]) -> str:
    def fill(match: Any) -> str:
        name = match.group(1)
        if name not in values:
            raise ProbeSetupError(f"No value for {{{name}}} in this run.")
        return values[name]

    return PLACEHOLDER_RE.sub(fill, path)


def resolve_body(body: Any, values: Mapping[str, str]) -> Any:
    """The body with placeholders filled in every string (keys stay as they are)."""
    if isinstance(body, str):
        return resolve_path(body, values)
    if isinstance(body, list):
        return [resolve_body(item, values) for item in body]
    if isinstance(body, dict):
        return {key: resolve_body(value, values) for key, value in body.items()}
    return body


@dataclass(frozen=True)
class ProbeOutcome:
    request: ProbeRequest
    url: str
    status: int | None
    code: str | None = None
    ms: int | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == self.request.expect

    def as_dict(self) -> dict[str, Any]:
        """The shape the `authz_probe` metric and the drill-down read."""
        return {
            "name": self.request.name,
            "method": self.request.method,
            "path": self.request.path,
            "url": self.url,
            "eval_headers": self.request.eval_headers,
            "expect": self.request.expect,
            "status": self.status,
            "code": self.code,
            "ok": self.ok,
            "ms": self.ms,
            **({"error": self.error} if self.error else {}),
        }


class Stopwatch:
    def __init__(self) -> None:
        self.started = time.perf_counter()

    def ms(self) -> int:
        return round((time.perf_counter() - self.started) * 1000)
