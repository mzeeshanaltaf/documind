"""Wilson score interval for binary metrics. A percentile bootstrap degenerates to [1, 1] when
every case passes; Wilson still says how sure 30/30 is (≈ [0.886, 1])."""

import math

Z_95 = 1.959963984540054  # two-sided 95 %


def wilson(successes: float, n: int, z: float = Z_95) -> tuple[float, float] | None:
    """The interval for `successes` out of `n` (None when n = 0). `successes` may be fractional
    only through float noise; it is clamped to [0, n]."""
    if n <= 0:
        return None
    p = min(max(successes / n, 0.0), 1.0)
    z2 = z * z
    denominator = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator
    return max(0.0, center - half), min(1.0, center + half)
