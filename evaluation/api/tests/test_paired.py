"""Paired statistics (E6): bootstrap, sign-flip permutation, McNemar, Holm, per-case classes."""

import itertools

import numpy as np
import pytest

from app.stats.paired import (
    classify_case,
    classify_change,
    compare_binary,
    compare_continuous,
    holm,
    mcnemar_exact,
    paired_bootstrap_ci,
    paired_proportion_ci,
    sign_flip_p,
)

DIFFS_8 = [0.3, -0.1, 0.25, 0.4, 0.05, -0.2, 0.15, 0.35]


def brute_force_p(diffs: list[float]) -> float:
    observed = abs(sum(diffs))
    hits = 0
    for signs in itertools.product((1, -1), repeat=len(diffs)):
        if abs(sum(s * d for s, d in zip(signs, diffs, strict=True))) >= observed - 1e-12:
            hits += 1
    return hits / 2 ** len(diffs)


def test_paired_bootstrap_finds_a_known_effect() -> None:
    rng = np.random.default_rng(7)
    a = rng.uniform(0.3, 0.7, size=40)
    b = a + 0.2 + rng.normal(0, 0.05, size=40)
    result = compare_continuous(list(a), list(b), seed=1)
    assert result.delta == pytest.approx(float(np.mean(b - a)))
    low, high = result.ci
    assert 0 < low < 0.2 < high < 0.25
    assert result.p is not None and result.p < 0.001


def test_paired_bootstrap_without_an_effect_covers_zero() -> None:
    rng = np.random.default_rng(11)
    a = rng.uniform(0, 1, size=40)
    b = a + rng.normal(0, 0.05, size=40)
    result = compare_continuous(list(a), list(b), seed=1)
    low, high = result.ci
    assert low < 0 < high
    assert result.p is not None and result.p > 0.05


def test_paired_bootstrap_is_seeded_and_handles_degenerate_input() -> None:
    assert paired_bootstrap_ci(DIFFS_8, 3) == paired_bootstrap_ci(DIFFS_8, 3)
    assert paired_bootstrap_ci([], 3) is None
    assert paired_bootstrap_ci([0.0, 0.0, 0.0], 3) == (0.0, 0.0)


def test_permutation_p_equals_exact_enumeration_at_n8() -> None:
    exact = brute_force_p(DIFFS_8)
    assert sign_flip_p(DIFFS_8, seed=5) == pytest.approx(exact, abs=1e-12)
    # The Monte Carlo path (forced) lands within sampling error of the exact value.
    sampled = sign_flip_p(DIFFS_8, seed=5, exact_max=0)
    assert sampled == pytest.approx(exact, abs=0.015)


def test_permutation_edge_cases() -> None:
    assert sign_flip_p([], 1) is None
    assert sign_flip_p([0.0, 0.0], 1) == 1.0
    # Five positive differences: only all-plus and all-minus reach the observed sum.
    assert sign_flip_p([0.1, 0.2, 0.3, 0.4, 0.5], 1) == pytest.approx(2 / 32)
    # Zeros don't change the statistic, so they don't count towards the exact limit.
    assert sign_flip_p([0.1, 0.2, 0.3, 0.4, 0.5] + [0.0] * 40, 1) == pytest.approx(2 / 32)


@pytest.mark.parametrize(
    ("a_only", "b_only", "p"),
    [
        (2, 10, 158 / 4096),  # 2·(C(12,0)+C(12,1)+C(12,2))/2^12
        (1, 8, 20 / 512),  # 2·(1 + 9)/2^9
        (0, 6, 2 / 64),
        (5, 5, 1.0),
        (0, 0, 1.0),
        (3, 1, 0.625),  # 2·(1 + 4)/16
    ],
)
def test_mcnemar_exact_against_textbook_values(a_only: int, b_only: int, p: float) -> None:
    assert mcnemar_exact(a_only, b_only) == pytest.approx(p)
    assert mcnemar_exact(b_only, a_only) == pytest.approx(p)


def test_binary_comparison_counts_discordant_pairs() -> None:
    a = [1, 1, 1, 0, 0, 1, 1, 0, 1, 1]
    b = [1, 0, 1, 1, 1, 1, 1, 1, 1, 1]
    result = compare_binary(a, b)
    assert (result.a_only, result.b_only, result.n) == (1, 3, 10)
    assert (result.mean_a, result.mean_b, result.delta) == (0.7, 0.9, pytest.approx(0.2))
    assert result.p == pytest.approx(mcnemar_exact(1, 3))
    low, high = result.ci
    assert low < 0.2 < high


def test_paired_proportion_ci_stays_in_bounds() -> None:
    low, high = paired_proportion_ci(0, 30, 30)
    assert -1 <= low < high <= 1 and low > 0.5
    low, high = paired_proportion_ci(0, 0, 30)
    assert low < 0 < high  # no discordance: centred on zero, not a degenerate [0, 0]
    assert paired_proportion_ci(0, 0, 0) is None


def test_holm_adjusts_in_step_down_order() -> None:
    adjusted = holm([0.01, 0.04, 0.03, 0.005])
    # Sorted 0.005, 0.01, 0.03, 0.04 × 4, 3, 2, 1 = 0.02, 0.03, 0.06, 0.04 → monotone 0.06.
    assert adjusted == pytest.approx([0.03, 0.06, 0.06, 0.02])
    assert holm([0.01, None, 0.5]) == [0.02, None, 0.5]
    assert holm([0.6, 0.7]) == [1.0, 1.0]
    assert holm([]) == []


@pytest.mark.parametrize(
    ("a", "b", "scale", "direction", "change"),
    [
        (0.5, 0.65, "unit", "higher", "improved"),
        (0.5, 0.55, "unit", "higher", "unchanged"),
        (0.5, 0.35, "unit", "higher", "regressed"),
        (1.0, 0.0, "binary", "higher", "regressed"),
        (0.0, 1.0, "binary", "lower", "regressed"),  # leakage appeared
        (1.0, 1.0, "binary", "higher", "unchanged"),
        (1000, 1200, "ms", "lower", "regressed"),
        (1000, 1050, "ms", "lower", "unchanged"),
    ],
)
def test_classify_change(a: float, b: float, scale: str, direction: str, change: str) -> None:
    assert classify_change(a, b, scale=scale, direction=direction) == change


def test_classify_case() -> None:
    assert classify_case([]) == "unchanged"
    assert classify_case(["improved", "unchanged"]) == "improved"
    assert classify_case(["regressed"]) == "regressed"
    assert classify_case(["improved", "regressed"]) == "mixed"
