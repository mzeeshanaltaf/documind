"""A/B comparison of two runs, paired on `case_key` (E6).

- Pairs are cases `done` in both runs; a metric pairs where both sides have an `ok` score.
  Cases in one run only, or not done in one, are listed and counted but never tested.
- Each metric gets its paired test (`app/stats/paired.py`); Holm adjusts across every quality
  metric shown. Δ is always B − A.
- Operational metrics (latency, TTFT, tokens, cost) are descriptive: Δ, CI and raw p, but outside
  the Holm family and never "significant". They follow the infrastructure, not the setup: an
  identical rerun minutes later gets ~99 % of its input from OpenAI's prompt cache instead of
  ~50 %, which alone cuts DocuMind's cost per case by ~45 %.
- Different dataset versions (or datasets) compare their shared case keys, with a warning.
  Different orgs can't be compared (422 `not_comparable`).
- The noise floor is an A/A pair on A's dataset: two completed, non-partial, original (not
  rejudged) runs with the same config hash, DocuMind version and judge prompts; one with A's or
  B's setup if there is one, else the newest. A metric is "within noise" when |Δ| ≤ that pair's.
"""

import asyncio
import math
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.metrics.registry import REGISTRY
from app.models import Case, DatasetVersion, MetricScore, Run, RunCase
from app.services import config_diff
from app.services import runs as run_service
from app.stats import paired
from app.stats.bootstrap import stable_seed

# Run-level metrics that aren't in the registry: (scale, direction, group).
RUN_LEVEL = {"case_pass": ("binary", "higher", "run")}
# Latency, tokens and cost move on every rerun: outside the Holm family and the case classes.
DESCRIPTIVE_GROUPS = frozenset({"operational"})
MODE_PREFERENCE = ("chat", "hybrid", "vector", "bm25")
AA_CANDIDATES = 50


def metric_info(key: str) -> tuple[str, str, str]:
    spec = REGISTRY.get(key)
    if spec is not None:
        return spec.scale, spec.direction, spec.group
    return RUN_LEVEL.get(key, ("unit", "higher", "other"))


_ORDER = {key: i for i, key in enumerate([*RUN_LEVEL, *REGISTRY])}


def metric_order(key: str) -> int:
    return _ORDER.get(key, len(_ORDER))


@dataclass
class CaseValues:
    run_case_id: uuid.UUID
    case_key: str
    question: str
    type: str
    position: int
    status: str
    passed: bool | None
    # metric → value for `ok` scores, None for na/error/refusal (absent = not scored).
    values: dict[str, float | None] = field(default_factory=dict)


def _finite(value: float | None) -> float | None:
    return None if value is None or math.isnan(value) else value


def _pairs(
    key: str, keys: Sequence[str], a: Mapping[str, CaseValues], b: Mapping[str, CaseValues]
) -> tuple[list[float], list[float], int]:
    """Aligned values of one metric over the paired case keys, and how many paired cases had
    no `ok` score on at least one side."""
    xs, ys, missing = [], [], 0
    for case_key in keys:
        x, y = a[case_key].values.get(key), b[case_key].values.get(key)
        if x is None or y is None:
            if key in a[case_key].values or key in b[case_key].values:
                missing += 1
            continue
        xs.append(x)
        ys.append(y)
    return xs, ys, missing


def metric_row(
    key: str,
    xs: Sequence[float],
    ys: Sequence[float],
    missing: int,
    seed: int,
    *,
    with_stats: bool = True,
) -> dict[str, Any]:
    scale, direction, group = metric_info(key)
    row: dict[str, Any] = {
        "key": key,
        "group": group,
        "scale": scale,
        "direction": direction,
        "test": "mcnemar" if scale == "binary" else "permutation",
        "n": len(xs),
        "n_missing": missing,
        "mean_a": None,
        "mean_b": None,
        "delta": None,
        "ci": None,
        "p": None,
        "discordant": None,
    }
    if not xs:
        return row
    if scale == "binary":
        binary = paired.compare_binary(xs, ys)
        row.update(
            mean_a=binary.mean_a,
            mean_b=binary.mean_b,
            delta=binary.delta,
            ci=list(binary.ci) if binary.ci and with_stats else None,
            p=binary.p if with_stats else None,
            discordant={"a_only": binary.a_only, "b_only": binary.b_only},
        )
        return row
    diffs = [y - x for x, y in zip(xs, ys, strict=True)]
    row.update(
        mean_a=sum(xs) / len(xs),
        mean_b=sum(ys) / len(ys),
        delta=sum(diffs) / len(diffs),
    )
    if with_stats:
        ci = paired.paired_bootstrap_ci(diffs, seed)
        row.update(ci=list(ci) if ci else None, p=paired.sign_flip_p(diffs, seed))
    return row


def build_comparison(
    a_id: str,
    b_id: str,
    cases_a: Mapping[str, CaseValues],
    cases_b: Mapping[str, CaseValues],
    metrics: Sequence[str] | None = None,
    noise: Mapping[str, float] | None = None,
    *,
    with_stats: bool = True,
) -> dict[str, Any]:
    """Pure: the metric rows, the per-case rows and the pairing summary of one comparison."""
    paired_keys = sorted(
        (
            k
            for k in cases_a.keys() & cases_b.keys()
            if cases_a[k].status == cases_b[k].status == "done"
        ),
        key=lambda k: (cases_a[k].position, k),
    )
    if metrics is None:
        present = {
            key
            for k in paired_keys
            for key, value in (*cases_a[k].values.items(), *cases_b[k].values.items())
            if value is not None
        }
        metrics = sorted(present, key=lambda key: (metric_order(key), key))

    rows = []
    for key in metrics:
        xs, ys, missing = _pairs(key, paired_keys, cases_a, cases_b)
        rows.append(
            metric_row(key, xs, ys, missing, stable_seed(a_id, b_id, key), with_stats=with_stats)
        )
    family = [row["group"] not in DESCRIPTIVE_GROUPS for row in rows]
    holm = paired.holm([r["p"] if tested else None for r, tested in zip(rows, family, strict=True)])
    for row, tested, adjusted in zip(rows, family, holm, strict=True):
        delta = _finite(row["delta"])
        floor = (noise or {}).get(row["key"])
        row.update(
            in_family=tested,
            p_holm=adjusted,
            significant=adjusted is not None and adjusted < paired.ALPHA,
            direction_good=(None if not delta else paired.is_good(delta, row["direction"])),
            noise_delta=floor,
            within_noise=(None if floor is None or delta is None else abs(delta) <= floor + 1e-12),
        )

    paired_set = set(paired_keys)
    order = {k: (c.position, k) for k, c in {**cases_b, **cases_a}.items()}
    case_rows = []
    counts = {"improved": 0, "regressed": 0, "mixed": 0, "unchanged": 0, "unpaired": 0}
    for case_key in sorted(order, key=order.__getitem__):
        a, b = cases_a.get(case_key), cases_b.get(case_key)
        values: dict[str, list[float | None]] = {}
        deltas: dict[str, float | None] = {}
        changes: dict[str, str] = {}
        for key in metrics:
            x = a.values.get(key) if a else None
            y = b.values.get(key) if b else None
            if x is None and y is None:
                continue
            values[key] = [x, y]
            deltas[key] = None if x is None or y is None else y - x
            if x is not None and y is not None:
                scale, direction, group = metric_info(key)
                if group in DESCRIPTIVE_GROUPS:
                    continue
                change = paired.classify_change(x, y, scale=scale, direction=direction)
                if change != "unchanged":
                    changes[key] = change
        is_paired = case_key in paired_set
        klass = paired.classify_case(list(changes.values())) if is_paired else "unpaired"
        counts[klass] += 1
        source = a or b
        assert source is not None
        case_rows.append(
            {
                "case_key": case_key,
                "question": source.question,
                "type": source.type,
                "run_case_id_a": a.run_case_id if a else None,
                "run_case_id_b": b.run_case_id if b else None,
                "status_a": a.status if a else None,
                "status_b": b.status if b else None,
                "passed_a": a.passed if a else None,
                "passed_b": b.passed if b else None,
                "values": values,
                "deltas": deltas,
                "changes": changes,
                "class": klass,
            }
        )

    n_paired = len(paired_keys)
    return {
        "metrics": rows,
        "cases": case_rows,
        "pairing": {
            "paired": n_paired,
            "only_a": len(cases_a.keys() - cases_b.keys()),
            "only_b": len(cases_b.keys() - cases_a.keys()),
            "not_done": len(cases_a.keys() & cases_b.keys()) - n_paired,
            "classes": counts,
            "flip_rate": (n_paired - counts["unchanged"]) / n_paired if n_paired else None,
        },
    }


# --- loading ---------------------------------------------------------------------------------


async def load_cases(
    session: AsyncSession, run_ids: Iterable[uuid.UUID], mode: str
) -> dict[uuid.UUID, dict[str, CaseValues]]:
    """run id → case key → the case's status and its scores in `mode` (+ `case_pass`)."""
    ids = list(run_ids)
    out: dict[uuid.UUID, dict[str, CaseValues]] = {run_id: {} for run_id in ids}
    rows = await session.execute(
        select(
            RunCase.run_id,
            RunCase.id,
            RunCase.case_key,
            RunCase.status,
            RunCase.passed,
            Case.question,
            Case.type,
            Case.position,
        )
        .join(Case, Case.id == RunCase.case_id)
        .where(RunCase.run_id.in_(ids))
    )
    for run_id, run_case_id, case_key, status, passed, question, case_type, position in rows:
        case = CaseValues(run_case_id, case_key, question, case_type, position, status, passed)
        if status == "done" and passed is not None:
            case.values["case_pass"] = float(passed)
        out[run_id][case_key] = case
    scores = await session.execute(
        select(
            RunCase.run_id,
            RunCase.case_key,
            MetricScore.metric,
            MetricScore.value,
            MetricScore.status,
        )
        .join(RunCase, RunCase.id == MetricScore.run_case_id)
        .where(RunCase.run_id.in_(ids), MetricScore.mode == mode)
    )
    for run_id, case_key, metric, value, status in scores:
        ok = status == "ok" and value is not None
        out[run_id][case_key].values[metric] = float(value) if ok else None
    return out


def run_modes(run: Run) -> list[str]:
    return ["chat"] if run.mode == "full" else list(run.config.get("retrieval_modes") or [])


def pick_mode(a: Run, b: Run, mode: str | None) -> str:
    shared = [m for m in run_modes(a) if m in run_modes(b)]
    if mode is not None:
        if mode not in shared:
            raise ApiError(
                422,
                "not_comparable",
                f"Both runs need scores in mode {mode!r}.",
                {"shared_modes": shared},
            )
        return mode
    for preferred in MODE_PREFERENCE:
        if preferred in shared:
            return preferred
    raise ApiError(
        422,
        "not_comparable",
        "The runs share no scoring mode (a full run scores `chat`; a retrieval-only run scores "
        "its retrieval modes).",
        {"modes_a": run_modes(a), "modes_b": run_modes(b)},
    )


def fingerprint(run: Run) -> tuple[Any, ...]:
    """Two runs with the same fingerprint differ only by chance: an A/A pair."""
    prompts = run.snapshot.get("prompts") or {}
    return (
        run.config_hash,
        (run.snapshot.get("documind") or {}).get("version"),
        tuple(sorted((k, (v or {}).get("sha256")) for k, v in prompts.items())),
    )


def pick_aa_pair(
    candidates: Sequence[Run],
    exclude: set[uuid.UUID],
    prefer: Sequence[tuple[Any, ...]] = (),
) -> tuple[Run, Run] | None:
    """The two newest runs of a fingerprint group with at least two runs (`candidates` newest
    first): a `prefer`red fingerprint's group first, else the newest group. When the two newest
    are exactly `exclude` (the runs being compared are themselves an A/A pair), a third run of
    the group stands in for one of them; with none, the pair is its own floor, which still beats
    a pair with another setup."""
    groups: dict[tuple[Any, ...], list[Run]] = {}
    for run in candidates:
        groups.setdefault(fingerprint(run), []).append(run)
    # dicts keep insertion order (newest group first); preferred groups move to the front.
    ordered = [groups[f] for f in dict.fromkeys(prefer) if f in groups]
    ordered += [g for f, g in groups.items() if f not in prefer]
    for group in ordered:
        if len(group) < 2:
            continue
        if {group[0].id, group[1].id} == exclude and len(group) > 2:
            return group[2], group[0]
        return group[1], group[0]
    return None


async def noise_floor(
    session: AsyncSession, a: Run, b: Run, mode: str, dataset_id: uuid.UUID
) -> dict[str, Any] | None:
    candidates = (
        await session.scalars(
            select(Run)
            .join(DatasetVersion, DatasetVersion.id == Run.dataset_version_id)
            .where(
                DatasetVersion.dataset_id == dataset_id,
                Run.status == "completed",
                Run.partial.is_(False),
                Run.source_run_id.is_(None),
                Run.mode == a.mode,
            )
            .order_by(Run.finished_at.desc())
            .limit(AA_CANDIDATES)
        )
    ).all()
    pair = pick_aa_pair(candidates, {a.id, b.id}, prefer=(fingerprint(a), fingerprint(b)))
    if pair is None or mode not in run_modes(pair[0]):
        return None
    first, second = pair
    cases = await load_cases(session, [first.id, second.id], mode)
    result = await asyncio.to_thread(
        build_comparison,
        str(first.id),
        str(second.id),
        cases[first.id],
        cases[second.id],
        with_stats=False,
    )
    return {
        "run_a": first.id,
        "run_b": second.id,
        "is_self": {first.id, second.id} == {a.id, b.id},
        "paired": result["pairing"]["paired"],
        "flip_rate": result["pairing"]["flip_rate"],
        "metrics": {
            row["key"]: abs(row["delta"]) for row in result["metrics"] if row["delta"] is not None
        },
    }


def warnings_for(
    a: Run, b: Run, ref_a: Mapping[str, Any], ref_b: Mapping[str, Any], pairing: Mapping[str, Any]
) -> list[str]:
    out = []
    if ref_a["dataset_id"] != ref_b["dataset_id"]:
        out.append(
            f"Different datasets ({ref_a['slug']} and {ref_b['slug']}): only the "
            f"{pairing['paired']} shared case keys are compared."
        )
    elif a.dataset_version_id != b.dataset_version_id:
        out.append(
            f"Different dataset versions (v{ref_a['version']} and v{ref_b['version']}): only the "
            f"{pairing['paired']} shared case keys are compared."
        )
    for label, run in (("A", a), ("B", b)):
        if run.status != "completed":
            out.append(f"Run {label} is {run.status}, not completed.")
        elif run.partial:
            out.append(f"Run {label} is partial: some cases never finished.")
    unpaired = pairing["only_a"] + pairing["only_b"] + pairing["not_done"]
    if unpaired:
        out.append(f"{unpaired} case(s) aren't done in both runs and are left out of the tests.")
    return out


async def compare(
    session: AsyncSession,
    a_id: uuid.UUID,
    b_id: uuid.UUID,
    *,
    metrics: Sequence[str] | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    if a_id == b_id:
        raise ApiError(422, "not_comparable", "Pick two different runs.")
    a, ref_a = await run_service.get_run_or_404(session, a_id)
    b, ref_b = await run_service.get_run_or_404(session, b_id)
    if a.org_id != b.org_id:
        raise ApiError(
            422,
            "not_comparable",
            f"The runs target different orgs ({a.org_slug} and {b.org_slug}), so their "
            "retrieval and answers can't be paired.",
        )
    if metrics is not None:
        unknown = [key for key in metrics if key not in REGISTRY and key not in RUN_LEVEL]
        if unknown:
            raise ApiError(422, "unknown_metric", f"Unknown metric(s): {', '.join(unknown)}")
    mode = pick_mode(a, b, mode)

    cases = await load_cases(session, [a.id, b.id], mode)
    floor = await noise_floor(session, a, b, mode, ref_a["dataset_id"])
    result = await asyncio.to_thread(
        build_comparison,
        str(a.id),
        str(b.id),
        cases[a.id],
        cases[b.id],
        metrics,
        floor["metrics"] if floor else None,
    )
    view_a = config_diff.comparable(a.mode, a.config, a.snapshot)
    view_b = config_diff.comparable(b.mode, b.config, b.snapshot)
    return {
        "a": (a, ref_a),
        "b": (b, ref_b),
        "mode": mode,
        "config_diff": [d.as_dict() for d in config_diff.diff(view_a, view_b)],
        "warnings": warnings_for(a, b, ref_a, ref_b, result["pairing"]),
        "noise_floor": floor,
        **result,
    }
