"""Judge calibration (E9): how well the Claude judge agrees with human reviewers, per metric ×
prompt version × judge model, and the badge each judge metric of a run carries.

**Pairs.** A reviewed metric pairs the judge's score on that run case with the human's grade.
The prompt version and model are those of the metric's own judge call (offline Claude Code
answers are their own "model", never pooled with Haiku's). With several reviewers on one case,
the earliest review is "the human"; the first two give the human-human ceiling. Faithfulness
pairs per claim (nominal κ) and also per case (its supported share, for ρ, MAE and bias); its n
counts cases, like every other metric's.

**Status** (`status_for`, on κw, or κ for the nominal faithfulness scale):

| Status | Rule |
|---|---|
| uncalibrated | n < 20, or κ undefined |
| unreliable | κ < 0.4 |
| moderate | 0.4 ≤ κ < 0.6, or κ ≥ 0.6 with n < 30 |
| calibrated | κ ≥ 0.6 and n ≥ 30 |
| stale | (per run) the metric's latest calibration is for another prompt version or model |

`compute()` rebuilds every row from scratch (reviews are few); the `calibration_compute` job
runs it after review submits (debounced) and `POST /v1/calibration/recompute` on demand.
"""

import uuid
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.judge import registry
from app.judge.offline import OFFLINE_MODEL
from app.metrics.registry import JUDGE_METRICS, MetricConfig
from app.models import Calibration, Claim, Prompt, PromptVersion, Run
from app.services.judging import JudgeConfig
from app.services.review import REVIEW_PROMPTS, REVIEWABLE, Reviewable
from app.stats.agreement import agreement, cohen_kappa, spearman, weighted_kappa

MIN_N = 20
CALIBRATED_N = 30
UNRELIABLE_BELOW = 0.4
CALIBRATED_FROM = 0.6
COMPUTE_LOCK_ID = 0x63616C69  # "cali"

# The metric's own judge call: the reviewable prompt among its calls (claims_verify, not
# claims_extract), first sample. Offline answers count as their own model.
CALL_SQL = """
    JOIN LATERAL (
        SELECT j.prompt_version_id,
               CASE WHEN j.model_actual = :offline THEN j.model_actual ELSE j.model END AS model
        FROM judge_calls j
        WHERE j.id = ANY(ms.judge_call_ids) AND j.prompt_version_id IS NOT NULL
        ORDER BY (j.purpose = ANY(:prompts)) DESC, j.sample_idx, j.created_at
        LIMIT 1
    ) jc ON true
"""
PAIRS_SQL = text(
    f"""
    SELECT r.run_case_id, r.metric, r.reviewer_id, r.value AS human, r.claim_verdicts,
           ms.value AS judge, jc.prompt_version_id, jc.model
    FROM reviews r
    JOIN metric_scores ms ON ms.run_case_id = r.run_case_id AND ms.metric = r.metric
         AND ms.mode = 'chat' AND ms.status = 'ok'
    {CALL_SQL}
    WHERE r.value IS NOT NULL AND r.metric = ANY(:metrics)
    ORDER BY r.created_at, r.id
    """
)
RETEST_SQL = text(
    f"""
    SELECT ms.metric, jc.prompt_version_id, jc.model, count(*) AS n, avg(ms.spread) AS spread
    FROM metric_scores ms
    {CALL_SQL}
    WHERE ms.metric = ANY(:metrics) AND ms.mode = 'chat' AND ms.status = 'ok'
      AND ms.n_samples > 1 AND ms.spread IS NOT NULL
    GROUP BY 1, 2, 3
    """
)
RUN_GROUPS_SQL = text(
    f"""
    SELECT ms.metric, jc.prompt_version_id, jc.model, count(*) AS n
    FROM metric_scores ms JOIN run_cases rc ON rc.id = ms.run_case_id
    {CALL_SQL}
    WHERE rc.run_id = :run_id AND ms.mode = 'chat' AND ms.metric = ANY(:metrics)
    GROUP BY 1, 2, 3
    """
)


def _params() -> dict[str, Any]:
    return {"offline": OFFLINE_MODEL, "prompts": list(REVIEW_PROMPTS)}


def status_for(n: int, primary: float | None) -> str:
    if n < MIN_N or primary is None:
        return "uncalibrated"
    if primary < UNRELIABLE_BELOW:
        return "unreliable"
    if primary < CALIBRATED_FROM or n < CALIBRATED_N:
        return "moderate"
    return "calibrated"


def primary_of(spec: Reviewable, kappa: float | None, kappa_weighted: float | None) -> float | None:
    return kappa_weighted if spec.ordinal else kappa


@dataclass
class Rated:
    """One run case's reviews of one metric, in submit order."""

    judge: float | None
    humans: list[float] = field(default_factory=list)
    claim_verdicts: list[Mapping[str, str]] = field(default_factory=list)


GroupKey = tuple[str, uuid.UUID, str]


def _claim_pairs(
    spec: Reviewable, judged: Mapping[int, str | None], human: Mapping[str, str]
) -> list[tuple[int, int]]:
    pairs = []
    for idx, verdict in judged.items():
        theirs = human.get(str(idx))
        if verdict in spec.labels and theirs in spec.labels:
            pairs.append((spec.labels.index(verdict), spec.labels.index(theirs)))  # type: ignore[arg-type]
    return pairs


def group_stats(
    spec: Reviewable,
    rated: Mapping[uuid.UUID, Rated],
    claims: Mapping[uuid.UUID, Mapping[int, str | None]],
) -> dict[str, Any]:
    """Every column of one calibration row (without its key) from the group's rated cases."""
    judge_idx, human_idx, values, human_pairs = [], [], [], []
    for run_case_id, item in rated.items():
        if not item.humans or item.judge is None:
            continue
        if spec.kind == "claims":
            pairs = _claim_pairs(spec, claims.get(run_case_id, {}), item.claim_verdicts[0])
            judge_idx += [j for j, _ in pairs]
            human_idx += [h for _, h in pairs]
            values.append((item.judge, item.humans[0]))
            if len(item.claim_verdicts) > 1:
                first, second = item.claim_verdicts[0], item.claim_verdicts[1]
                human_pairs += [
                    (spec.labels.index(first[k]), spec.labels.index(second[k]))
                    for k in sorted(first, key=int)
                    if first.get(k) in spec.labels and second.get(k) in spec.labels
                ]
            continue
        judge, human = spec.category(item.judge), spec.category(item.humans[0])
        assert judge is not None and human is not None
        judge_idx.append(judge)
        human_idx.append(human)
        if len(item.humans) > 1:
            second = spec.category(item.humans[1])
            assert second is not None
            human_pairs.append((human, second))
    n = len(values) if spec.kind == "claims" else len(judge_idx)
    stats = agreement(judge_idx, human_idx, spec.k, ordinal=spec.ordinal)
    row: dict[str, Any] = {
        "n": n,
        "kappa": stats.kappa,
        "kappa_weighted": stats.kappa_weighted,
        "spearman": stats.spearman,
        "exact_pct": stats.exact_pct,
        "within1_pct": stats.within1_pct,
        "mae": stats.mae,
        "bias": stats.bias,
    }
    if spec.kind == "claims" and values:
        judged, humans = [j for j, _ in values], [h for _, h in values]
        row["spearman"] = spearman(judged, humans)
        row["mae"] = sum(abs(j - h) for j, h in values) / len(values)
        row["bias"] = sum(j - h for j, h in values) / len(values)
    human_kappa = None
    if human_pairs:
        first, second = [a for a, _ in human_pairs], [b for _, b in human_pairs]
        human_kappa = (
            weighted_kappa(first, second, spec.k)
            if spec.ordinal
            else cohen_kappa(first, second, spec.k)
        )
    row["human_kappa"] = human_kappa
    row["confusion"] = {"labels": list(spec.labels), "matrix": stats.confusion}
    row["details"] = {
        "kind": spec.kind,
        "primary": "kappa_weighted" if spec.ordinal else "kappa",
        "units": len(judge_idx),  # claims for faithfulness, cases otherwise
        # The scatter: category indices, or (judge, human) faithfulness per case.
        "pairs": [list(p) for p in values] if spec.kind == "claims"
        else [[j, h] for j, h in zip(judge_idx, human_idx, strict=True)],
        "human": {"n": len(human_pairs), "kappa": human_kappa},
        "reviewers": sorted({len(item.humans) for item in rated.values() if item.humans}),
    }  # fmt: skip
    row["status"] = status_for(n, primary_of(spec, row["kappa"], row["kappa_weighted"]))
    return row


async def compute(session: AsyncSession) -> int:
    """Rebuild every calibration row. Returns how many groups there are."""
    await session.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": COMPUTE_LOCK_ID})
    params = {**_params(), "metrics": list(REVIEWABLE)}
    rated: dict[GroupKey, dict[uuid.UUID, Rated]] = defaultdict(dict)
    claim_cases: set[uuid.UUID] = set()
    for row in (await session.execute(PAIRS_SQL, params)).mappings():
        key = (row["metric"], row["prompt_version_id"], row["model"])
        item = rated[key].setdefault(row["run_case_id"], Rated(judge=row["judge"]))
        item.humans.append(row["human"])
        if row["claim_verdicts"]:
            item.claim_verdicts.append(row["claim_verdicts"])
            claim_cases.add(row["run_case_id"])
    claims: dict[uuid.UUID, dict[int, str | None]] = defaultdict(dict)
    if claim_cases:
        for claim in await session.scalars(select(Claim).where(Claim.run_case_id.in_(claim_cases))):
            claims[claim.run_case_id][claim.idx] = claim.verdict
    retest = {
        (row["metric"], row["prompt_version_id"], row["model"]): row
        for row in (await session.execute(RETEST_SQL, params)).mappings()
    }
    await session.execute(delete(Calibration))
    keys = set(rated) | set(retest)
    for key in keys:
        metric, prompt_version_id, model = key
        spec = REVIEWABLE[metric]
        row = group_stats(spec, rated.get(key, {}), claims)
        if key in retest:
            spread = retest[key]["spread"]
            row["details"]["retest"] = {
                "n": retest[key]["n"],
                "mean_spread_steps": float(spread) * (spec.spread_steps or 1.0),
            }
        session.add(
            Calibration(
                id=uuid.uuid4(),
                metric=metric,
                prompt_version_id=prompt_version_id,
                judge_model=model,
                **row,
            )
        )
    await session.flush()
    return len(keys)


# --- reading -----------------------------------------------------------------------------------


async def list_rows(session: AsyncSession) -> list[tuple[Calibration, str, int]]:
    """Every row with its prompt key and version number, newest prompt versions first."""
    rows = await session.execute(
        select(Calibration, Prompt.key, PromptVersion.version)
        .join(PromptVersion, PromptVersion.id == Calibration.prompt_version_id)
        .join(Prompt, Prompt.id == PromptVersion.prompt_id)
        .order_by(Calibration.metric, PromptVersion.version.desc(), Calibration.judge_model)
    )
    return [(cal, key, version) for cal, key, version in rows.all()]


@dataclass(frozen=True)
class Target:
    """The prompt version and judge model a metric was (or would be) judged with."""

    prompt_version_id: uuid.UUID | None
    prompt_version: int | None
    judge_model: str


def badge(
    metric: str,
    target: Target | None,
    rows: Sequence[tuple[Calibration, str, int]],
) -> dict[str, Any]:
    """A metric's calibration status against one prompt version and model."""
    spec = REVIEWABLE.get(metric)
    out: dict[str, Any] = {
        "metric": metric,
        "reviewable": spec is not None,
        "status": "uncalibrated",
        "n": 0,
        "kappa": None,
        "primary": None,
        "calibration_id": None,
        "prompt_version": target.prompt_version if target else None,
        "judge_model": target.judge_model if target else None,
        "latest": None,
    }
    if spec is None:
        return out
    mine = [r for r in rows if r[0].metric == metric and r[0].n > 0]
    exact = next(
        (
            r for r in mine
            if target and r[0].prompt_version_id == target.prompt_version_id
            and r[0].judge_model == target.judge_model
        ),
        None,
    )  # fmt: skip
    if exact is not None:
        cal = exact[0]
        out.update(
            status=cal.status,
            n=cal.n,
            kappa=primary_of(spec, cal.kappa, cal.kappa_weighted),
            primary=cal.details.get("primary"),
            calibration_id=cal.id,
        )
        return out
    if mine:
        # The latest = the highest prompt version (rows come newest first).
        cal, _key, version = mine[0]
        out.update(
            status="stale",
            latest={
                "calibration_id": cal.id,
                "prompt_version": version,
                "judge_model": cal.judge_model,
                "status": cal.status,
                "n": cal.n,
                "kappa": primary_of(spec, cal.kappa, cal.kappa_weighted),
            },
        )
    return out


def run_judge_metrics(run: Run) -> list[str]:
    enabled = MetricConfig.from_config(run.config.get("metrics")).enabled_judge_metrics()
    return sorted(m for m in enabled if m in JUDGE_METRICS)


async def run_badges(session: AsyncSession, run: Run) -> list[dict[str, Any]]:
    """Every judge metric of the run with its badge. The run's prompt version and model per
    metric are those its scores were judged with (the most common), else what its config and
    snapshot say it will use."""
    metrics = run_judge_metrics(run)
    found: dict[str, Counter[tuple[uuid.UUID, str]]] = defaultdict(Counter)
    for row in (
        await session.execute(
            RUN_GROUPS_SQL, {**_params(), "run_id": run.id, "metrics": list(REVIEWABLE)}
        )
    ).mappings():
        found[row["metric"]][(row["prompt_version_id"], row["model"])] += row["n"]
    refs = (run.snapshot or {}).get("prompts") or {}
    config = JudgeConfig.from_config(run.config.get("judge"))
    offline = ((run.snapshot or {}).get("eval") or {}).get("judge_mode") == "offline"
    versions = {
        v.id: v.version
        for v in await session.scalars(
            select(PromptVersion).where(
                PromptVersion.id.in_(
                    [vid for c in found.values() for vid, _ in c]
                    + [uuid.UUID(r["version_id"]) for r in refs.values()]
                )
            )
        )
    }
    rows = await list_rows(session)
    out = []
    for metric in metrics:
        spec = REVIEWABLE.get(metric)
        target = None
        if spec is not None and found.get(metric):
            (version_id, model), _n = found[metric].most_common(1)[0]
            target = Target(version_id, versions.get(version_id), model)
        elif spec is not None and spec.prompt in refs:
            version_id = uuid.UUID(refs[spec.prompt]["version_id"])
            prompt = registry.file_specs().get(spec.prompt)
            model = OFFLINE_MODEL if offline else (config.model_for(prompt) if prompt else "")
            target = Target(version_id, versions.get(version_id), model)
        out.append(badge(metric, target, rows))
    return out


async def current_badges(session: AsyncSession) -> list[dict[str, Any]]:
    """Each reviewable metric against the prompt files as they are now and their default
    model (the dashboard's chips). Read-only: a file edit not yet synced is a new version."""
    specs = registry.file_specs()
    shas = {spec.prompt: specs[spec.prompt].sha256 for spec in REVIEWABLE.values()}
    stored = {
        v.sha256: v
        for v in await session.scalars(
            select(PromptVersion).where(PromptVersion.sha256.in_(list(shas.values())))
        )
    }
    rows = await list_rows(session)
    out = []
    for metric, spec in REVIEWABLE.items():
        version = stored.get(shas[spec.prompt])
        target = Target(
            version.id if version else None,
            version.version if version else None,
            specs[spec.prompt].model,
        )
        out.append(badge(metric, target, rows))
    return out
