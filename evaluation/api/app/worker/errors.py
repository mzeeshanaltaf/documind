from datetime import timedelta


class RetryLater(Exception):
    """Requeue without spending an attempt (rate limits)."""

    def __init__(self, delay: timedelta, reason: str = "") -> None:
        super().__init__(reason or f"retry in {delay.total_seconds():.0f} s")
        self.delay = delay


class PermanentJobError(Exception):
    """Fail now: a retry can't succeed (e.g. a 4xx from DocuMind)."""
