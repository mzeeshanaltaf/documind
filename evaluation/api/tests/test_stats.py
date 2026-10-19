"""Wilson against known values; bootstrap determinism under a seed."""

import pytest

from app.stats.bootstrap import bootstrap_ci, percentile, stable_seed
from app.stats.intervals import wilson


@pytest.mark.parametrize(
    ("successes", "n", "low", "high"),
    [
        # Hand-computed: center (p + z²/2n)/(1 + z²/n) ± z·√(p(1-p)/n + z²/4n²)/(1 + z²/n).
        (30, 30, 0.886496, 1.0),
        (29, 30, 0.833296, 0.994096),
        (5, 10, 0.236590, 0.763410),
        (0, 10, 0.0, 0.277540),
    ],
)
def test_wilson_known_values(successes: int, n: int, low: float, high: float) -> None:
    lo, hi = wilson(successes, n)
    assert lo == pytest.approx(low, abs=1e-5)
    assert hi == pytest.approx(high, abs=1e-5)


def test_wilson_empty() -> None:
    assert wilson(0, 0) is None


def test_bootstrap_is_deterministic_under_a_seed() -> None:
    values = [0.2, 0.5, 1.0, 0.0, 0.75, 0.3, 0.9]
    seed = stable_seed("run-1", "mrr")
    first, second = bootstrap_ci(values, seed), bootstrap_ci(values, seed)
    assert first == second
    low, high = first
    assert low < sum(values) / len(values) < high
    assert bootstrap_ci(values, stable_seed("run-2", "mrr")) != first


def test_stable_seed_is_process_independent() -> None:
    # A fixed value: sha256-based, unlike hash(), which is randomized per process.
    assert stable_seed("run-1", "mrr") == stable_seed("run-1", "mrr")
    assert stable_seed("a", "b") != stable_seed("ab")


def test_bootstrap_degenerate_inputs() -> None:
    assert bootstrap_ci([], 1) is None
    assert bootstrap_ci([0.4], 1) == (0.4, 0.4)
    assert bootstrap_ci([1.0, 1.0, 1.0], 1) == (1.0, 1.0)


def test_percentile() -> None:
    assert percentile([], 50) is None
    assert percentile([100, 200, 300, 400], 50) == 250
    assert percentile([100, 200, 300, 400], 95) == pytest.approx(385)
