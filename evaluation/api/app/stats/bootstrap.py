"""Percentile bootstrap for continuous metrics, seeded so the same run always gets the same CI."""

import hashlib
from collections.abc import Sequence

import numpy as np

B = 2000


def stable_seed(*parts: object) -> int:
    """A process-independent seed (Python's `hash()` of a str is randomized per process)."""
    digest = hashlib.sha256("\x1f".join(str(part) for part in parts).encode()).digest()
    return int.from_bytes(digest[:8], "big")


def bootstrap_ci(
    values: Sequence[float], seed: int, *, b: int = B, level: float = 0.95
) -> tuple[float, float] | None:
    """The percentile interval of the mean over `b` resamples (None for no values)."""
    data = np.asarray(values, dtype=float)
    n = data.size
    if n == 0:
        return None
    if n == 1 or np.all(data == data[0]):
        return float(data[0]), float(data[0])
    rng = np.random.default_rng(seed)
    means = data[rng.integers(0, n, size=(b, n))].mean(axis=1)
    tail = (1 - level) / 2 * 100
    low, high = np.percentile(means, [tail, 100 - tail])
    return float(low), float(high)


def percentile(values: Sequence[float], q: float) -> float | None:
    """Linear-interpolated percentile (numpy's default), None for no values."""
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=float), q))
