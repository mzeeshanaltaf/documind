"""Judge-vs-human agreement (E9): two raters' labels for the same items.

Labels are category indices 0..K-1 (the order matters for the weighted statistics). Rater `a` is
the judge and `b` the human throughout, so `bias` = mean(a − b) is positive when the judge grades
higher, and the confusion matrix has the judge's categories as rows.

- Cohen's κ (nominal): (p_o − p_e) / (1 − p_e).
- Quadratic-weighted κ (ordinal): 1 − Σ w·O / Σ w·E with w_ij = (i − j)² / (K − 1)². With two
  categories it equals Cohen's κ.
- Spearman's ρ: Pearson's r of the ranks, ties sharing their average rank.

A κ is undefined (None) when chance agreement is already total (both raters always used the same
single category), and ρ when either rater is constant.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


def _check(a: Sequence[int], b: Sequence[int], k: int) -> tuple[np.ndarray, np.ndarray]:
    if len(a) != len(b):
        raise ValueError("Both raters need a label for every item")
    x, y = np.asarray(a, dtype=int), np.asarray(b, dtype=int)
    if x.size and (min(x.min(), y.min()) < 0 or max(x.max(), y.max()) >= k):
        raise ValueError(f"Labels must be category indices in 0..{k - 1}")
    return x, y


def confusion(a: Sequence[int], b: Sequence[int], k: int) -> list[list[int]]:
    """counts[i][j] = items rater a put in category i and rater b in j."""
    x, y = _check(a, b, k)
    matrix = np.zeros((k, k), dtype=int)
    np.add.at(matrix, (x, y), 1)
    return matrix.tolist()


def _weighted(a: Sequence[int], b: Sequence[int], k: int, weights: np.ndarray) -> float | None:
    """1 − Σ w·O / Σ w·E over proportions; w = 1 off the diagonal gives Cohen's κ."""
    if not len(a):
        return None
    observed = np.asarray(confusion(a, b, k), dtype=float) / len(a)
    expected = np.outer(observed.sum(axis=1), observed.sum(axis=0))
    chance = float((weights * expected).sum())
    if chance <= 1e-12:
        return None
    return 1.0 - float((weights * observed).sum()) / chance


def cohen_kappa(a: Sequence[int], b: Sequence[int], k: int) -> float | None:
    return _weighted(a, b, k, 1.0 - np.eye(k))


def weighted_kappa(a: Sequence[int], b: Sequence[int], k: int) -> float | None:
    """Quadratic weights."""
    if k < 2:
        return None
    i, j = np.indices((k, k))
    return _weighted(a, b, k, (i - j) ** 2 / (k - 1) ** 2)


def average_ranks(values: Sequence[float]) -> list[float]:
    """1-based ranks; tied values get the mean of the ranks they span."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start
        while end + 1 < len(order) and values[order[end + 1]] == values[order[start]]:
            end += 1
        for position in range(start, end + 1):
            ranks[order[position]] = (start + end) / 2 + 1
        start = end + 1
    return ranks


def spearman(a: Sequence[float], b: Sequence[float]) -> float | None:
    if len(a) != len(b):
        raise ValueError("Both raters need a value for every item")
    if len(a) < 2:
        return None
    x, y = np.asarray(average_ranks(a)), np.asarray(average_ranks(b))
    x, y = x - x.mean(), y - y.mean()
    denominator = float(np.sqrt((x * x).sum() * (y * y).sum()))
    if denominator <= 1e-12:
        return None
    return float((x * y).sum()) / denominator


@dataclass(frozen=True)
class Agreement:
    n: int
    kappa: float | None
    kappa_weighted: float | None  # None for nominal scales
    spearman: float | None
    exact_pct: float | None
    within1_pct: float | None  # ordinal scales with more than two categories only
    mae: float | None
    bias: float | None  # mean(judge − human), in category steps
    confusion: list[list[int]]


def agreement(judge: Sequence[int], human: Sequence[int], k: int, *, ordinal: bool) -> Agreement:
    """Every statistic for one metric's (judge, human) category pairs."""
    x, y = _check(judge, human, k)
    n = int(x.size)
    if not n:
        return Agreement(0, None, None, None, None, None, None, None, confusion([], [], k))
    diff = x - y
    return Agreement(
        n=n,
        kappa=cohen_kappa(judge, human, k),
        kappa_weighted=weighted_kappa(judge, human, k) if ordinal else None,
        spearman=spearman(x.tolist(), y.tolist()) if ordinal else None,
        exact_pct=float((diff == 0).mean()),
        within1_pct=float((np.abs(diff) <= 1).mean()) if ordinal and k > 2 else None,
        mae=float(np.abs(diff).mean()) if ordinal else None,
        bias=float(diff.mean()) if ordinal else None,
        confusion=confusion(judge, human, k),
    )
