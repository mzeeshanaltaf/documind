"""Paired statistics for A/B comparisons (E6): two runs scored on the same cases, paired on
`case_key`. Every test here works on per-case differences d = B − A.

- Continuous metrics: the mean difference, a paired percentile bootstrap 95 % CI (B = 5000,
  seeded) and a two-sided sign-flip permutation p-value (10k random flips; exact enumeration when
  at most 16 differences are non-zero, since zeros can't change the statistic).
- Binary metrics: an exact McNemar test on the discordant pairs, plus the difference in
  proportions with an Agresti–Min 95 % CI (a Wald interval after adding ½ to every cell, which
  keeps its coverage when there are few discordant pairs).
- Holm–Bonferroni adjusts the p-values of every metric shown in one comparison.
- Per-case classification: a metric improved or regressed when |Δ| > 0.1 (unit scores), > 10 % of
  the larger value (ms / tokens / USD), or flipped (binary).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np

from app.stats.intervals import Z_95

BOOTSTRAP_B = 5000
PERMUTATIONS = 10_000
EXACT_MAX = 16  # 2^16 sign patterns: exact enumeration stays cheap
UNIT_EPSILON = 0.1
RELATIVE_EPSILON = 0.1
ALPHA = 0.05

Change = Literal["improved", "regressed", "unchanged"]
CaseClass = Literal["improved", "regressed", "mixed", "unchanged"]


def paired_bootstrap_ci(
    diffs: Sequence[float], seed: int, *, b: int = BOOTSTRAP_B, level: float = 0.95
) -> tuple[float, float] | None:
    """Percentile interval of the mean difference, resampling whole pairs."""
    data = np.asarray(diffs, dtype=float)
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


def sign_flip_p(
    diffs: Sequence[float],
    seed: int,
    *,
    permutations: int = PERMUTATIONS,
    exact_max: int = EXACT_MAX,
) -> float | None:
    """Two-sided p-value of H0 "A and B are exchangeable within each pair": the share of sign
    patterns whose |Σ ±dᵢ| reaches the observed |Σ dᵢ|. Exact over all 2^m patterns of the m
    non-zero differences when m ≤ `exact_max`, else Monte Carlo with the +1 correction
    (Phipson & Smyth), so p is never 0."""
    data = np.asarray(diffs, dtype=float)
    if data.size == 0:
        return None
    nonzero = data[data != 0]
    m = nonzero.size
    if m == 0:
        return 1.0
    observed = abs(nonzero.sum())
    tolerance = 1e-9 * max(1.0, float(np.abs(nonzero).sum()))
    if m <= exact_max:
        patterns = np.arange(2**m, dtype=np.int64)[:, None] >> np.arange(m) & 1
        signs = 1 - 2 * patterns  # bit 0 → +1, bit 1 → −1
        sums = np.abs(signs @ nonzero)
        return float(np.mean(sums >= observed - tolerance))
    rng = np.random.default_rng(seed)
    signs = rng.choice(np.array([-1.0, 1.0]), size=(permutations, m))
    sums = np.abs(signs @ nonzero)
    return float((np.sum(sums >= observed - tolerance) + 1) / (permutations + 1))


def mcnemar_exact(a_only: int, b_only: int) -> float:
    """Two-sided exact McNemar p-value: a binomial test of the discordant pairs at ½.
    `a_only` = pairs where only A passed, `b_only` = only B passed."""
    m = a_only + b_only
    if m == 0:
        return 1.0
    k = min(a_only, b_only)
    tail = sum(math.comb(m, i) for i in range(k + 1)) / 2**m
    return min(1.0, 2 * tail)


def paired_proportion_ci(
    a_only: int, b_only: int, n: int, *, z: float = Z_95
) -> tuple[float, float] | None:
    """Agresti–Min CI of p_B − p_A for n pairs (½ added to each of the four cells)."""
    if n <= 0:
        return None
    n_adj = n + 2
    p_b = (b_only + 0.5) / n_adj
    p_a = (a_only + 0.5) / n_adj
    diff = p_b - p_a
    se = math.sqrt(max(0.0, (p_a + p_b - diff * diff) / n_adj))
    return max(-1.0, diff - z * se), min(1.0, diff + z * se)


def holm(pvalues: Sequence[float | None]) -> list[float | None]:
    """Holm–Bonferroni step-down adjusted p-values, in the input order (None passes through and
    doesn't count towards the family size)."""
    indexed = sorted((p, i) for i, p in enumerate(pvalues) if p is not None)
    m = len(indexed)
    adjusted: list[float | None] = [None] * len(pvalues)
    running = 0.0
    for rank, (p, i) in enumerate(indexed):
        running = max(running, min(1.0, (m - rank) * p))
        adjusted[i] = running
    return adjusted


@dataclass(frozen=True)
class ContinuousResult:
    n: int
    mean_a: float
    mean_b: float
    delta: float
    ci: tuple[float, float] | None
    p: float | None


@dataclass(frozen=True)
class BinaryResult:
    n: int
    mean_a: float
    mean_b: float
    delta: float
    ci: tuple[float, float] | None
    p: float
    a_only: int  # discordant: A passed, B didn't
    b_only: int


def compare_continuous(a: Sequence[float], b: Sequence[float], seed: int) -> ContinuousResult:
    """`a` and `b` are aligned pairs (same case at the same index)."""
    if len(a) != len(b):
        raise ValueError("paired samples must have the same length")
    diffs = [y - x for x, y in zip(a, b, strict=True)]
    n = len(diffs)
    return ContinuousResult(
        n=n,
        mean_a=float(np.mean(a)) if n else math.nan,
        mean_b=float(np.mean(b)) if n else math.nan,
        delta=float(np.mean(diffs)) if n else math.nan,
        ci=paired_bootstrap_ci(diffs, seed),
        p=sign_flip_p(diffs, seed),
    )


def compare_binary(a: Sequence[float], b: Sequence[float]) -> BinaryResult:
    """Values ≥ 0.5 count as a pass."""
    if len(a) != len(b):
        raise ValueError("paired samples must have the same length")
    pairs = [(x >= 0.5, y >= 0.5) for x, y in zip(a, b, strict=True)]
    n = len(pairs)
    a_only = sum(1 for x, y in pairs if x and not y)
    b_only = sum(1 for x, y in pairs if y and not x)
    passes_a = sum(1 for x, _ in pairs if x)
    passes_b = sum(1 for _, y in pairs if y)
    return BinaryResult(
        n=n,
        mean_a=passes_a / n if n else math.nan,
        mean_b=passes_b / n if n else math.nan,
        delta=(b_only - a_only) / n if n else math.nan,
        ci=paired_proportion_ci(a_only, b_only, n),
        p=mcnemar_exact(a_only, b_only),
        a_only=a_only,
        b_only=b_only,
    )


def is_good(delta: float, direction: str) -> bool:
    return delta > 0 if direction == "higher" else delta < 0


def classify_change(a: float, b: float, *, scale: str, direction: str) -> Change:
    """One metric on one case: did B move it by more than the noise band, and which way?"""
    delta = b - a
    if scale == "binary":
        moved = (a >= 0.5) != (b >= 0.5)
    elif scale == "unit":
        moved = abs(delta) > UNIT_EPSILON
    else:  # ms, count, usd: relative to the larger magnitude
        moved = abs(delta) > RELATIVE_EPSILON * max(abs(a), abs(b))
    if not moved:
        return "unchanged"
    return "improved" if is_good(delta, direction) else "regressed"


def classify_case(changes: Sequence[Change]) -> CaseClass:
    improved = "improved" in changes
    regressed = "regressed" in changes
    if improved and regressed:
        return "mixed"
    if regressed:
        return "regressed"
    return "improved" if improved else "unchanged"
