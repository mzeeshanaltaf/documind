"""Human review (E9): which judge metrics people can grade, sampling a run's cases into a queue,
the item a reviewer sees (the judge's own case packet and rubric), and saving their grades.

**Reviewable metrics** (`REVIEWABLE`) and how a grade becomes a category:

| Metric | Reviewer picks | Categories |
|---|---|---|
| `answer_quality.<dimension>`, `followup_resolution` | a score 1–5 | `1`…`5` (ordinal) |
| `answer_quality` | the verdict | fail, borderline, pass (ordinal) |
| `behavior_correct` | the behaviour class | fail, pass (allowed by the expected behaviour?) |
| `faithfulness` | a verdict per claim | supported, not_found, contradicted (nominal) |

A review's `value` is on the metric's own scale (as in `metric_scores.value`), so (s − 1) / 4 for
a 1–5 score; a `null` label means the reviewer found the metric not applicable (kept, but left
out of the statistics).

**Sampling** (seeded, so a queue can be re-created exactly):
- `stratified`: bucket the eligible cases by the judge's category on the queue's first metric
  and take from each bucket in turn, so every score level the judge used is covered;
- `random`: uniform;
- `disagreement`: cases where the judge is least consistent: the N-sample spread, or metrics
  that disagree (faithful but incorrect, a passing verdict over a failing dimension, …).
Items are shuffled, so their order doesn't give the buckets away.

**Blind queues** hide the judge's scores and reasoning from a reviewer until they have submitted
their own grades for the item; after that their grades can't be changed.
"""

import math
import random
import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.judge import registry
from app.judge.render import BEHAVIOR_TEXT, format_source
from app.judge.rubric import parse_rubric
from app.metrics.behavior import ALLOWED
from app.metrics.generation import QUALITY_DIMENSIONS
from app.models import (
    Case,
    Claim,
    MetricScore,
    RetrievedContext,
    Review,
    ReviewItem,
    ReviewQueue,
    Run,
    RunCase,
)
from app.services.case_results import context_from_row
from app.worker import queue as jobs
from app.worker.handlers.case_judge import conversation_of

Kind = Literal["ordinal", "binary", "claims"]
BEHAVIORS = ("answered", "partial", "abstained", "clarified", "followed_injection")
SCORES = ("1", "2", "3", "4", "5")
# A reviewer's submit schedules one recompute this much later; later submits join it.
COMPUTE_DEBOUNCE = timedelta(seconds=20)


@dataclass(frozen=True)
class Reviewable:
    key: str
    kind: Kind
    labels: tuple[str, ...]  # the statistics' categories, in order
    prompt: str  # the judge prompt whose version a calibration belongs to
    section: str  # the rubric's section in that prompt
    group: str | None = None  # the rubric group (a dimension), None = the whole section
    anchors: tuple[str, ...] | None = None  # keep only these anchors of the section
    choices: tuple[str, ...] | None = None  # what the reviewer picks, when not the labels
    # Category steps per unit of the stored N-sample spread: dimensions store it in rubric
    # points, the verdict on its 0–1 value (None: the metric isn't sampled N times).
    spread_steps: float | None = None
    description: str = ""

    @property
    def k(self) -> int:
        return len(self.labels)

    @property
    def ordinal(self) -> bool:
        return self.kind != "claims"

    def category(self, value: float | None) -> int | None:
        """A metric value (0–1) as a category index: (K − 1) · value, rounded half up."""
        if value is None or self.kind == "claims":
            return None
        return min(max(math.floor(value * (self.k - 1) + 0.5), 0), self.k - 1)

    def label_of(self, value: float | None) -> str | None:
        index = self.category(value)
        return None if index is None else self.labels[index]


DIMENSION_TEXT = {
    "correctness": "Agreement with the reference answer and key facts.",
    "completeness": "Covers what the sources offer for the question.",
    "relevance": "Stays on the question.",
    "jurisdiction_handling": "The right country's rules, or clearly separated variations.",
    "refusal_helpfulness": "A warranted refusal or question that says what's missing.",
}

REVIEWABLE: dict[str, Reviewable] = {
    spec.key: spec
    for spec in (
        *(
            Reviewable(
                f"answer_quality.{dimension}",
                "ordinal",
                SCORES,
                "judge.answer_quality",
                "Dimensions and anchors",
                group=dimension,
                spread_steps=1.0,
                description=DIMENSION_TEXT[dimension],
            )  # fmt: skip
            for dimension in QUALITY_DIMENSIONS
        ),
        Reviewable(
            "answer_quality",
            "ordinal",
            ("fail", "borderline", "pass"),
            "judge.answer_quality",
            "Verdict, summary, issues",
            anchors=("verdict",),
            spread_steps=2.0,
            description="The rubric judge's overall verdict.",
        ),
        Reviewable(
            "followup_resolution",
            "ordinal",
            SCORES,
            "judge.followup_resolution",
            "Anchors",
            description="The standalone query resolves the follow-up's references.",
        ),
        Reviewable(
            "behavior_correct",
            "binary",
            ("fail", "pass"),
            "judge.behavior",
            "Behaviours",
            choices=BEHAVIORS,
            description="The response class is one the expected behaviour allows.",
        ),
        Reviewable(
            "faithfulness",
            "claims",
            ("supported", "not_found", "contradicted"),
            "judge.claims_verify",
            "Verdicts",
            description="Each extracted claim against the numbered sources.",
        ),
    )  # fmt: skip
}
REVIEW_PROMPTS = tuple(dict.fromkeys(spec.prompt for spec in REVIEWABLE.values()))


def check_metrics(metrics: Sequence[str]) -> list[str]:
    unknown = [m for m in metrics if m not in REVIEWABLE]
    if unknown:
        raise ApiError(
            422, "not_reviewable", f"Not reviewable: {', '.join(unknown)}.",
            {"reviewable": list(REVIEWABLE)},
        )  # fmt: skip
    if not metrics:
        raise ApiError(422, "no_metrics", "Pick at least one metric to review.")
    return list(dict.fromkeys(metrics))


# --- sampling (pure) ---------------------------------------------------------------------------


def faithfulness_bucket(value: float) -> str:
    if value >= 1.0:
        return "1.0"
    if value >= 0.8:
        return "0.8-1"
    return "0.5-0.8" if value >= 0.5 else "<0.5"


def bucket_of(spec: Reviewable, value: float | None) -> str | None:
    if value is None:
        return None
    return faithfulness_bucket(value) if spec.kind == "claims" else spec.label_of(value)


def stratified_sample(
    buckets: Mapping[str, Sequence[uuid.UUID]], size: int, seed: int
) -> list[uuid.UUID]:
    """Round-robin over the buckets (each shuffled), so they fill evenly until one runs out."""
    rng = random.Random(seed)
    pools = {}
    for name in sorted(buckets):
        pool = sorted(buckets[name], key=str)
        rng.shuffle(pool)
        pools[name] = pool
    picked: list[uuid.UUID] = []
    while len(picked) < size and any(pools.values()):
        for pool in pools.values():
            if pool and len(picked) < size:
                picked.append(pool.pop())
    rng.shuffle(picked)
    return picked


def random_sample(ids: Iterable[uuid.UUID], size: int, seed: int) -> list[uuid.UUID]:
    pool = sorted(ids, key=str)
    random.Random(seed).shuffle(pool)
    return pool[:size]


def disagreement_score(scores: Mapping[str, tuple[float | None, float | None]]) -> float:
    """0–1: the largest N-sample spread (as a share of the scale) or gap between metrics that
    should agree. `scores` = metric → (value, spread) of one case."""

    def value(key: str) -> float | None:
        return scores[key][0] if key in scores else None

    gaps = []
    for key, (_value, spread) in scores.items():
        spec = REVIEWABLE.get(key)
        if spread and spec and spec.spread_steps:
            gaps.append(spread * spec.spread_steps / (spec.k - 1))
    faithfulness, correctness = value("faithfulness"), value("answer_quality.correctness")
    if faithfulness is not None and correctness is not None:
        gaps.append(abs(faithfulness - correctness))
    verdict = value("answer_quality")
    dimensions = [v for d in QUALITY_DIMENSIONS if (v := value(f"answer_quality.{d}")) is not None]
    if verdict is not None and dimensions:
        gaps.append(abs(verdict - min(dimensions)))
    behaved = value("behavior_correct")
    if verdict is not None and behaved is not None:
        gaps.append(abs(verdict - behaved))
    return min(max(gaps, default=0.0), 1.0)


def disagreement_sample(scores: Mapping[uuid.UUID, float], size: int, seed: int) -> list[uuid.UUID]:
    """The most-disagreeing cases (score > 0), ties in seeded order."""
    rng = random.Random(seed)
    candidates = sorted((rc for rc, d in scores.items() if d > 0), key=str)
    rng.shuffle(candidates)
    ranked = sorted(candidates, key=lambda rc: -scores[rc])[:size]
    rng.shuffle(ranked)
    return ranked


# --- queues ------------------------------------------------------------------------------------

SCORES_SQL = text(
    """
    SELECT ms.run_case_id, ms.metric, ms.value, ms.spread
    FROM metric_scores ms JOIN run_cases rc ON rc.id = ms.run_case_id
    WHERE rc.run_id = :run_id AND rc.status = 'done' AND ms.mode = 'chat' AND ms.status = 'ok'
      AND ms.metric = ANY(:metrics)
    """
)


async def run_scores(
    session: AsyncSession, run_id: uuid.UUID
) -> dict[uuid.UUID, dict[str, tuple[float | None, float | None]]]:
    rows = await session.execute(SCORES_SQL, {"run_id": run_id, "metrics": list(REVIEWABLE)})
    scores: dict[uuid.UUID, dict[str, tuple[float | None, float | None]]] = defaultdict(dict)
    for run_case_id, metric, value, spread in rows:
        scores[run_case_id][metric] = (value, spread)
    return scores


def sample(
    sampling: str,
    metrics: Sequence[str],
    scores: Mapping[uuid.UUID, Mapping[str, tuple[float | None, float | None]]],
    size: int,
    seed: int,
) -> tuple[list[uuid.UUID], dict[str, Any]]:
    """The picked run cases and the sampling stats. Eligible = the judge scored the first
    metric."""
    primary = REVIEWABLE[metrics[0]]
    eligible = {
        rc: bucket_of(primary, by_metric[primary.key][0])
        for rc, by_metric in scores.items()
        if primary.key in by_metric and by_metric[primary.key][0] is not None
    }
    buckets: dict[str, list[uuid.UUID]] = defaultdict(list)
    for rc, bucket in eligible.items():
        buckets[str(bucket)].append(rc)
    if sampling == "stratified":
        picked = stratified_sample(buckets, size, seed)
    elif sampling == "random":
        picked = random_sample(eligible, size, seed)
    else:
        picked = disagreement_sample(
            {rc: disagreement_score(scores[rc]) for rc in eligible}, size, seed
        )
    details = {
        "eligible": len(eligible),
        "stratified_by": primary.key,
        "available": {name: len(ids) for name, ids in sorted(buckets.items())},
        "picked": {
            name: sum(1 for rc in picked if str(eligible[rc]) == name) for name in sorted(buckets)
        },
    }
    return picked, details


async def create_queue(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    name: str | None,
    metrics: Sequence[str],
    sampling: str,
    size: int,
    blind: bool,
    seed: int | None,
    created_by: str,
) -> ReviewQueue:
    metrics = check_metrics(metrics)
    run = await session.get(Run, run_id)
    if run is None:
        raise ApiError(404, "not_found", "Run not found.")
    if run.mode != "full":
        raise ApiError(422, "not_reviewable", "Only full (judged) runs can be reviewed.")
    seed = seed if seed is not None else random.SystemRandom().randrange(1, 2**31)
    picked, details = sample(sampling, metrics, await run_scores(session, run_id), size, seed)
    if not picked:
        raise ApiError(
            422, "no_eligible_cases",
            f"No case of this run has a judge score for {metrics[0]}"
            + (" with a disagreement to look at." if sampling == "disagreement" else "."),
        )  # fmt: skip
    queue = ReviewQueue(
        id=uuid.uuid4(),
        run_id=run_id,
        name=name or f"{run.name or 'Run ' + str(run.id)[:8]} · {metrics[0]}",
        metrics=metrics,
        sampling=sampling,
        seed=seed,
        size=size,
        blind=blind,
        details=details,
        created_by=created_by,
    )
    session.add(queue)
    await session.flush()
    session.add_all(
        ReviewItem(id=uuid.uuid4(), queue_id=queue.id, run_case_id=rc, position=i)
        for i, rc in enumerate(picked, start=1)
    )
    await session.flush()
    return queue


PROGRESS_SQL = text(
    """
    SELECT i.id, i.queue_id, i.position, i.status, i.skipped_by, i.run_case_id, rc.case_key,
      (SELECT count(*) FROM metric_scores ms WHERE ms.run_case_id = i.run_case_id
         AND ms.mode = 'chat' AND ms.status = 'ok' AND ms.metric = ANY(q.metrics)) AS gradable,
      (SELECT count(*) FROM reviews r WHERE r.run_case_id = i.run_case_id
         AND r.reviewer_id = :reviewer AND r.metric = ANY(q.metrics)) AS mine,
      (SELECT count(DISTINCT r.reviewer_id) FROM reviews r WHERE r.run_case_id = i.run_case_id
         AND r.metric = ANY(q.metrics)) AS reviewers
    FROM review_items i JOIN review_queues q ON q.id = i.queue_id
      JOIN run_cases rc ON rc.id = i.run_case_id
    WHERE i.queue_id = ANY(:queue_ids)
    ORDER BY i.queue_id, i.position
    """
)


@dataclass(frozen=True)
class ItemState:
    id: uuid.UUID
    queue_id: uuid.UUID
    position: int
    status: str
    case_key: str
    run_case_id: uuid.UUID
    reviewers: int
    mine_done: bool
    mine_skipped: bool


async def item_states(
    session: AsyncSession, queue_ids: Sequence[uuid.UUID], reviewer: str
) -> dict[uuid.UUID, list[ItemState]]:
    """Every item of the queues with this reviewer's progress (one query for all queues)."""
    states: dict[uuid.UUID, list[ItemState]] = defaultdict(list)
    if not queue_ids:
        return states
    rows = await session.execute(PROGRESS_SQL, {"queue_ids": list(queue_ids), "reviewer": reviewer})
    for row in rows.mappings():
        states[row["queue_id"]].append(
            ItemState(
                id=row["id"],
                queue_id=row["queue_id"],
                position=row["position"],
                status=row["status"],
                case_key=row["case_key"],
                run_case_id=row["run_case_id"],
                reviewers=row["reviewers"],
                mine_done=row["gradable"] > 0 and row["mine"] >= row["gradable"],
                mine_skipped=reviewer in (row["skipped_by"] or []),
            )
        )
    return states


def progress(states: Sequence[ItemState]) -> dict[str, int]:
    done = sum(1 for s in states if s.mine_done)
    skipped = sum(1 for s in states if s.mine_skipped and not s.mine_done)
    return {
        "total": len(states),
        "done": sum(1 for s in states if s.status == "done"),
        "skipped": sum(1 for s in states if s.status == "skipped"),
        "mine_done": done,
        "mine_skipped": skipped,
        "mine_remaining": len(states) - done - skipped,
        "double_graded": sum(1 for s in states if s.reviewers >= 2),
    }


def next_item(states: Sequence[ItemState]) -> ItemState | None:
    return next((s for s in states if not s.mine_done and not s.mine_skipped), None)


async def get_queue_or_404(session: AsyncSession, queue_id: uuid.UUID) -> ReviewQueue:
    queue = await session.get(ReviewQueue, queue_id)
    if queue is None:
        raise ApiError(404, "not_found", "Review queue not found.")
    return queue


async def get_item_or_404(
    session: AsyncSession, queue_id: uuid.UUID, item_id: uuid.UUID, *, for_update: bool = False
) -> ReviewItem:
    stmt = select(ReviewItem).where(ReviewItem.id == item_id, ReviewItem.queue_id == queue_id)
    item = (await session.scalars(stmt.with_for_update() if for_update else stmt)).one_or_none()
    if item is None:
        raise ApiError(404, "not_found", "Review item not found.")
    return item


# --- the item a reviewer sees ------------------------------------------------------------------


async def rubrics_for(session: AsyncSession, run: Run, metrics: Sequence[str]) -> dict[str, Any]:
    """Each metric's anchors, from the prompt version the run judged with."""
    refs = (run.snapshot or {}).get("prompts") or {}
    current = registry.file_specs()
    out = {}
    for metric in metrics:
        spec = REVIEWABLE[metric]
        ref = refs.get(spec.prompt)
        prompt = (
            await registry.load_version(session, uuid.UUID(ref["version_id"]))
            if ref
            else current[spec.prompt]
        )
        rubric = parse_rubric(prompt.system, spec.section)
        groups = rubric["groups"]
        if spec.group:
            groups = [g for g in groups if g["key"] == spec.group]
        if spec.anchors:
            groups = [
                {**g, "anchors": [a for a in g["anchors"] if a["label"] in spec.anchors]}
                for g in groups
            ]
        out[metric] = {
            **rubric,
            "groups": groups,
            "prompt": spec.prompt,
            "prompt_version": ref.get("version") if ref else None,
        }
    return out


def metric_meta(metric: str) -> dict[str, Any]:
    spec = REVIEWABLE[metric]
    return {
        "key": metric,
        "kind": spec.kind,
        "labels": list(spec.labels),
        "choices": list(spec.choices or spec.labels),
        "description": spec.description,
    }


def judge_view(spec: Reviewable, score: MetricScore, claims: Sequence[Claim]) -> dict[str, Any]:
    """What the judge said for one metric, revealed after the reviewer's own grade."""
    details = score.details or {}
    view: dict[str, Any] = {
        "value": score.value,
        "label": spec.label_of(score.value),
        "n_samples": score.n_samples,
        "spread": score.spread,
    }
    if spec.key.startswith("answer_quality."):
        view["reasoning"] = details.get("analysis")
        view["samples"] = details.get("samples")
    elif spec.key == "answer_quality":
        view["reasoning"] = details.get("summary")
        view["issues"] = details.get("issues")
    elif spec.key == "behavior_correct":
        view["choice"] = details.get("behavior")
        view["reasoning"] = details.get("reasoning")
    elif spec.key == "followup_resolution":
        view["reasoning"] = details.get("reasoning")
    elif spec.kind == "claims":
        view["claims"] = [
            {
                "idx": c.idx,
                "verdict": c.verdict,
                "reasoning": c.reasoning,
                "evidence_quote": c.evidence_quote,
                "supporting_ns": c.supporting_ns,
            }
            for c in claims
        ]
    return view


def review_out(review: Review) -> dict[str, Any]:
    return {
        "metric": review.metric,
        "value": review.value,
        "label": review.label,
        "comment": review.comment,
        "claim_verdicts": review.claim_verdicts,
        "updated_at": review.updated_at,
    }


async def item_view(
    session: AsyncSession, queue: ReviewQueue, item: ReviewItem, reviewer: str
) -> dict[str, Any]:
    """The case packet the judge saw (question, conversation, expected behaviour, reference,
    the sources numbered as DocuMind numbered them, the answer), the rubric, the claims to
    grade, this reviewer's own grades, and, unless the queue is blind and they haven't graded
    the item yet, the judge's scores."""
    run_case = await session.get(RunCase, item.run_case_id)
    assert run_case is not None  # FK CASCADE
    case = await session.get(Case, run_case.case_id)
    run = await session.get(Run, run_case.run_id)
    assert case is not None and run is not None
    scores = {
        s.metric: s
        for s in await session.scalars(
            select(MetricScore).where(
                MetricScore.run_case_id == run_case.id,
                MetricScore.mode == "chat",
                MetricScore.status == "ok",
                MetricScore.metric.in_(queue.metrics),
            )
        )
    }
    gradable = [m for m in queue.metrics if m in scores]
    contexts = (
        await session.scalars(
            select(RetrievedContext)
            .where(RetrievedContext.run_case_id == run_case.id)
            .order_by(RetrievedContext.mode, RetrievedContext.rank)
        )
    ).all()
    claims = (
        await session.scalars(
            select(Claim).where(Claim.run_case_id == run_case.id).order_by(Claim.idx)
        )
    ).all()
    mine = {
        r.metric: r
        for r in await session.scalars(
            select(Review).where(
                Review.run_case_id == run_case.id,
                Review.reviewer_id == reviewer,
                Review.metric.in_(queue.metrics),
            )
        )
    }
    revealed = not queue.blind or bool(mine)
    sources = []
    for row in contexts:
        header, _, body = format_source(context_from_row(row)).partition("\n")
        sources.append(
            {
                "n": row.n,
                "header": header,  # the line the judge read, as DocuMind formats it
                "doc_code": row.doc_code,
                "title": row.title,
                "section_number": row.section_number,
                "section_title": row.section_title,
                "page_start": row.page_start,
                "page_end": row.page_end,
                "jurisdiction": row.jurisdiction,
                "text": body,
            }
        )
    return {
        "id": item.id,
        "queue_id": queue.id,
        "position": item.position,
        "status": item.status,
        "run_id": run.id,
        "run_case_id": run_case.id,
        "case_key": run_case.case_key,
        "case_type": case.type,
        "packet": {
            "question": case.question,
            "conversation": [
                {"role": t.role, "content": t.content} for t in conversation_of(run_case)
            ],
            "expected_behavior": case.expected_behavior,
            "expected_behavior_text": BEHAVIOR_TEXT.get(case.expected_behavior, ""),
            "reference_answer": case.reference_answer,
            "key_facts": case.key_facts or [],
            "standalone_query": (run_case.routing or {}).get("standalone_query"),
            "sources": sources,
            "answer": run_case.answer or "",
        },
        "metrics": [metric_meta(m) for m in gradable],
        "rubrics": await rubrics_for(session, run, gradable),
        "claims": [{"idx": c.idx, "text": c.text, "citation_ns": c.citation_ns} for c in claims]
        if "faithfulness" in gradable
        else [],
        "mine": {metric: review_out(r) for metric, r in mine.items()},
        "revealed": revealed,
        "locked": queue.blind and bool(mine),
        "judge": {m: judge_view(REVIEWABLE[m], scores[m], claims) for m in gradable}
        if revealed
        else None,
    }


# --- grading -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Grade:
    metric: str
    label: str | None = None  # None = not applicable
    comment: str | None = None
    claim_verdicts: Mapping[str, str] | None = None


def grade_value(
    spec: Reviewable, grade: Grade, *, expected_behavior: str, claim_ids: Sequence[int]
) -> tuple[float | None, str | None, dict[str, str] | None]:
    """(value, label, claim verdicts) of one grade, or a 422 when it doesn't fit the metric."""
    if spec.kind == "claims":
        verdicts = {str(k): v for k, v in (grade.claim_verdicts or {}).items()}
        if grade.label is None and not verdicts:
            return None, None, None
        wanted = {str(i) for i in claim_ids}
        if set(verdicts) != wanted or any(v not in spec.labels for v in verdicts.values()):
            raise ApiError(
                422, "bad_grade",
                f"{spec.key}: give one of {', '.join(spec.labels)} for every claim "
                f"({', '.join(sorted(wanted, key=int))}).",
            )  # fmt: skip
        supported = sum(1 for v in verdicts.values() if v == "supported")
        return supported / len(verdicts), None, verdicts
    if grade.label is None:
        return None, None, None
    choices = spec.choices or spec.labels
    if grade.label not in choices:
        raise ApiError(
            422, "bad_grade", f"{spec.key}: the grade must be one of {', '.join(choices)}."
        )
    if spec.kind == "binary":
        allowed = ALLOWED.get(expected_behavior, frozenset())
        return float(grade.label in allowed), grade.label, None
    return spec.labels.index(grade.label) / (spec.k - 1), grade.label, None


async def schedule_compute(session: AsyncSession) -> None:
    """Debounced: one queued `calibration_compute` covers every submit until it runs."""
    queued = await session.scalar(
        text("SELECT 1 FROM jobs WHERE kind = 'calibration_compute' AND status = 'queued' LIMIT 1")
    )
    if not queued:
        await jobs.enqueue(session, "calibration_compute", delay=COMPUTE_DEBOUNCE)


async def submit(
    session: AsyncSession,
    queue: ReviewQueue,
    item: ReviewItem,
    reviewer: str,
    grades: Sequence[Grade],
) -> None:
    """Save one reviewer's grades for every metric the judge scored on the item."""
    run_case = await session.get(RunCase, item.run_case_id)
    assert run_case is not None
    case = await session.get(Case, run_case.case_id)
    assert case is not None
    gradable = set(
        await session.scalars(
            select(MetricScore.metric).where(
                MetricScore.run_case_id == run_case.id,
                MetricScore.mode == "chat",
                MetricScore.status == "ok",
                MetricScore.metric.in_(queue.metrics),
            )
        )
    )
    by_metric = {g.metric: g for g in grades}
    extra = set(by_metric) - gradable
    missing = gradable - set(by_metric)
    if extra or missing:
        raise ApiError(
            422, "bad_grades",
            "Grade exactly the item's metrics.",
            {"expected": sorted(gradable), "missing": sorted(missing), "extra": sorted(extra)},
        )  # fmt: skip
    claim_ids = list(
        await session.scalars(
            select(Claim.idx).where(Claim.run_case_id == run_case.id).order_by(Claim.idx)
        )
    )
    existing = {
        r.metric: r
        for r in await session.scalars(
            select(Review).where(
                Review.run_case_id == run_case.id,
                Review.reviewer_id == reviewer,
                Review.metric.in_(list(gradable)),
            )
        )
    }
    if queue.blind and existing:
        raise ApiError(
            409, "review_locked",
            "You've seen the judge's grades for this case, so your blind grades can't change.",
        )  # fmt: skip
    for metric, grade in by_metric.items():
        value, label, verdicts = grade_value(
            REVIEWABLE[metric], grade, expected_behavior=case.expected_behavior,
            claim_ids=claim_ids,
        )  # fmt: skip
        review = existing.get(metric) or Review(
            id=uuid.uuid4(), run_case_id=run_case.id, metric=metric, reviewer_id=reviewer
        )
        review.value, review.label, review.claim_verdicts = value, label, verdicts
        review.comment = (grade.comment or "").strip() or None
        session.add(review)
    item.status = "done"
    await session.flush()
    await schedule_compute(session)


async def skip(session: AsyncSession, item: ReviewItem, reviewer: str) -> None:
    if reviewer not in item.skipped_by:
        item.skipped_by = [*item.skipped_by, reviewer]
    if item.status == "pending":
        item.status = "skipped"
    await session.flush()
