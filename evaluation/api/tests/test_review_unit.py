"""E9 without a database: agreement statistics (checked against scikit-learn and scipy on these
inputs), the calibration status rules and badges, sampling, rubric parsing and grading."""

import uuid
from collections import Counter

import pytest

from app.core.errors import ApiError
from app.judge import registry
from app.judge.rubric import parse_rubric
from app.models import Calibration
from app.services import calibration
from app.services.calibration import Rated, Target, badge, group_stats, status_for
from app.services.review import (
    REVIEWABLE,
    Grade,
    disagreement_sample,
    disagreement_score,
    grade_value,
    random_sample,
    sample,
    stratified_sample,
)
from app.stats.agreement import (
    agreement,
    average_ranks,
    cohen_kappa,
    confusion,
    spearman,
    weighted_kappa,
)

# --- agreement ----------------------------------------------------------------------------------


def test_cohen_kappa_textbook() -> None:
    # Wikipedia's example: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no → p_o 0.7, p_e 0.5, κ 0.4.
    a = [1] * 25 + [0] * 25
    b = [1] * 20 + [0] * 5 + [1] * 10 + [0] * 15
    assert cohen_kappa(a, b, 2) == pytest.approx(0.4)
    assert confusion(a, b, 2) == [[15, 10], [5, 20]]


def test_weighted_kappa_and_spearman_on_a_rubric_sample() -> None:
    judge = [0, 1, 2, 3, 4, 4, 3, 2]
    human = [0, 2, 2, 3, 3, 4, 4, 1]
    assert cohen_kappa(judge, human, 5) == pytest.approx(0.36)  # sklearn
    assert weighted_kappa(judge, human, 5) == pytest.approx(95 / 111)  # sklearn, quadratic
    assert spearman(judge, human) == pytest.approx(137 / 162)  # scipy


def test_spearman_textbook_and_ties() -> None:
    # Wikipedia: IQ vs hours of TV per week, ρ = −29/165.
    iq = [106, 100, 86, 101, 99, 103, 97, 113, 112, 110]
    tv = [7, 27, 2, 50, 28, 29, 20, 12, 6, 17]
    assert spearman(iq, tv) == pytest.approx(-29 / 165)
    assert average_ranks([1, 2, 2, 3]) == [1, 2.5, 2.5, 4]
    assert spearman([1, 2, 2, 3, 4], [1, 3, 2, 2, 5]) == pytest.approx(29 / 38)  # scipy


def test_all_agree_and_perfect_disagreement() -> None:
    labels = [0, 1, 2, 3, 4, 2]
    assert cohen_kappa(labels, labels, 5) == pytest.approx(1.0)
    assert weighted_kappa(labels, labels, 5) == pytest.approx(1.0)
    assert spearman(labels, labels) == pytest.approx(1.0)
    assert cohen_kappa([0, 1, 0, 1], [1, 0, 1, 0], 2) == pytest.approx(-1.0)
    assert weighted_kappa([0, 4], [4, 0], 5) == pytest.approx(-1.0)
    assert spearman([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    # Everyone used one category: chance agreement is total, κ and ρ are undefined.
    assert cohen_kappa([4, 4, 4], [4, 4, 4], 5) is None
    assert weighted_kappa([4, 4, 4], [4, 4, 4], 5) is None
    assert spearman([4, 4, 4], [3, 4, 5]) is None


def test_binary_weighted_kappa_equals_cohen() -> None:
    a, b = [0, 1, 1, 0, 1, 1], [0, 1, 0, 0, 1, 1]
    assert weighted_kappa(a, b, 2) == pytest.approx(cohen_kappa(a, b, 2))


def test_agreement_summary() -> None:
    stats = agreement([4, 3, 2, 4], [3, 3, 2, 2], 5, ordinal=True)
    assert stats.n == 4
    assert stats.exact_pct == 0.5 and stats.within1_pct == 0.75
    assert stats.mae == 0.75 and stats.bias == 0.75  # the judge grades higher
    assert stats.confusion[4][3] == 1 and stats.confusion[4][2] == 1
    nominal = agreement([0, 1, 2], [0, 1, 1], 3, ordinal=False)
    assert nominal.kappa_weighted is None and nominal.within1_pct is None
    assert nominal.exact_pct == pytest.approx(2 / 3)
    with pytest.raises(ValueError):
        agreement([5], [0], 5, ordinal=True)


# --- status rules and badges -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("n", "kw", "expected"),
    [
        (19, 0.9, "uncalibrated"),
        (25, None, "uncalibrated"),
        (25, 0.39, "unreliable"),
        (40, -0.2, "unreliable"),
        (25, 0.4, "moderate"),
        (40, 0.59, "moderate"),
        (25, 0.8, "moderate"),  # κw high, but fewer than 30 items
        (30, 0.6, "calibrated"),
    ],
)
def test_status_rules(n: int, kw: float | None, expected: str) -> None:
    assert status_for(n, kw) == expected


def _row(metric: str, version_id: uuid.UUID, model: str, n: int, kw: float, version: int):
    cal = Calibration(
        id=uuid.uuid4(), metric=metric, prompt_version_id=version_id, judge_model=model, n=n,
        kappa=kw, kappa_weighted=kw, status=status_for(n, kw),
        details={"primary": "kappa_weighted"},
    )  # fmt: skip
    return cal, "judge.answer_quality", version


def test_badge_exact_stale_and_uncalibrated() -> None:
    v1, v2 = uuid.uuid4(), uuid.uuid4()
    metric = "answer_quality.correctness"
    rows = [_row(metric, v1, "claude-haiku-5-5", 32, 0.71, 1)]
    exact = badge(metric, Target(v1, 1, "claude-haiku-5-5"), rows)
    assert exact["status"] == "calibrated" and exact["n"] == 32 and exact["kappa"] == 0.71
    # The prompt file was edited (v2): the run is judged by an uncalibrated prompt.
    stale = badge(metric, Target(v2, 2, "claude-haiku-5-5"), rows)
    assert stale["status"] == "stale" and stale["calibration_id"] is None
    assert stale["latest"]["prompt_version"] == 1 and stale["latest"]["status"] == "calibrated"
    # Another judge model is stale too, and a metric nobody graded is uncalibrated.
    assert badge(metric, Target(v1, 1, "claude-sonnet-5-5"), rows)["status"] == "stale"
    assert badge("faithfulness", Target(v1, 1, "m"), rows)["status"] == "uncalibrated"
    other = badge("context_precision", Target(v1, 1, "m"), rows)
    assert other["reviewable"] is False and other["status"] == "uncalibrated"
    # Regraded under v2: its own (smaller) calibration wins over the old one.
    rows.insert(0, _row(metric, v2, "claude-haiku-5-5", 12, 0.9, 2))
    assert badge(metric, Target(v2, 2, "claude-haiku-5-5"), rows)["status"] == "uncalibrated"


def test_group_stats_ordinal_with_a_second_reviewer() -> None:
    spec = REVIEWABLE["answer_quality.correctness"]
    to_value = {s: (s - 1) / 4 for s in range(1, 6)}
    rated = {
        uuid.uuid4(): Rated(judge=to_value[j], humans=[to_value[h] for h in hs])
        for j, hs in [(5, [5, 4]), (4, [3, 3]), (2, [2]), (1, [2]), (3, [3])]
    }
    row = group_stats(spec, rated, {})
    assert row["n"] == 5 and row["status"] == "uncalibrated"
    assert row["details"]["pairs"] == [[4, 4], [3, 2], [1, 1], [0, 1], [2, 2]]
    assert row["bias"] == pytest.approx(0.0) and row["exact_pct"] == pytest.approx(0.6)
    assert row["human_kappa"] == weighted_kappa([4, 2], [3, 2], 5)
    assert row["details"]["human"]["n"] == 2
    assert row["confusion"]["labels"] == ["1", "2", "3", "4", "5"]


def test_group_stats_faithfulness_pairs_claims() -> None:
    spec = REVIEWABLE["faithfulness"]
    a, b = uuid.uuid4(), uuid.uuid4()
    rated = {
        a: Rated(1.0, [0.5], [{"1": "supported", "2": "not_found"}]),
        b: Rated(0.5, [0.5], [{"1": "contradicted", "2": "supported"}]),
    }
    claims = {a: {1: "supported", 2: "supported"}, b: {1: "contradicted", 2: "not_found"}}
    row = group_stats(spec, rated, claims)
    assert row["n"] == 2 and row["details"]["units"] == 4  # two cases, four claims
    assert row["kappa_weighted"] is None and row["details"]["primary"] == "kappa"
    assert row["exact_pct"] == 0.5
    assert row["bias"] == pytest.approx(0.25) and row["mae"] == pytest.approx(0.25)
    assert row["details"]["pairs"] == [[1.0, 0.5], [0.5, 0.5]]


# --- sampling ----------------------------------------------------------------------------------


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.UUID(int=i + 1) for i in range(n)]


def test_stratified_covers_every_bucket_evenly() -> None:
    ids = _ids(40)
    buckets = {"5": ids[:30], "4": ids[30:36], "3": ids[36:39], "1": ids[39:]}
    picked = stratified_sample(buckets, 10, seed=7)
    by_bucket = Counter(next(b for b, members in buckets.items() if rc in members) for rc in picked)
    assert by_bucket == {"1": 1, "3": 3, "4": 3, "5": 3}  # small buckets taken whole first
    assert len(set(picked)) == 10
    assert stratified_sample(buckets, 10, seed=7) == picked  # seeded
    assert stratified_sample(buckets, 10, seed=8) != picked
    assert len(stratified_sample(buckets, 100, seed=1)) == 40  # can't exceed the eligible


def test_sample_buckets_by_the_first_metric() -> None:
    ids = _ids(12)
    scores = {
        rc: {"answer_quality.correctness": ((i % 4) / 4, None), "faithfulness": (1.0, None)}
        for i, rc in enumerate(ids)
    }
    scores[uuid.uuid4()] = {"faithfulness": (0.5, None)}  # no correctness score: not eligible
    picked, details = sample("stratified", ["answer_quality.correctness"], scores, 8, seed=3)
    assert details["eligible"] == 12
    assert details["available"] == {"1": 3, "2": 3, "3": 3, "4": 3}
    assert details["picked"] == {"1": 2, "2": 2, "3": 2, "4": 2}
    assert set(picked) <= set(ids)
    _picked, details = sample("stratified", ["faithfulness"], scores, 8, seed=3)
    assert details["available"] == {"0.5-0.8": 1, "1.0": 12}
    assert random_sample(ids, 5, seed=2) == random_sample(ids, 5, seed=2)


def test_disagreement_prefers_inconsistent_cases() -> None:
    steady, split, contradictory = _ids(3)
    scores = {
        steady: {"answer_quality.completeness": (0.75, 0.0), "answer_quality": (1.0, None)},
        split: {"answer_quality.completeness": (0.5, 1.0)},  # samples 1 point apart
        contradictory: {"faithfulness": (1.0, None), "answer_quality.correctness": (0.0, None)},
    }
    ranked = {rc: disagreement_score(s) for rc, s in scores.items()}
    assert ranked[contradictory] == 1.0 and ranked[split] == pytest.approx(0.25)
    assert ranked[steady] == pytest.approx(0.25)  # pass verdict over a 4/5 dimension
    assert disagreement_sample(ranked, 1, seed=0) == [contradictory]
    assert disagreement_sample({steady: 0.0}, 5, seed=0) == []


# --- rubric & grading --------------------------------------------------------------------------


def test_rubric_comes_from_the_prompt_files() -> None:
    specs = registry.file_specs()
    rubric = parse_rubric(specs["judge.answer_quality"].system, "Dimensions and anchors")
    groups = {g["key"]: g for g in rubric["groups"]}
    assert list(groups) == [
        "correctness", "completeness", "relevance", "jurisdiction_handling", "refusal_helpfulness"
    ]  # fmt: skip
    assert [a["label"] for a in groups["correctness"]["anchors"]] == ["5", "4", "3", "2", "1"]
    assert groups["correctness"]["anchors"][0]["text"].startswith("every key fact present")
    assert [a["label"] for a in groups["completeness"]["anchors"]] == ["5", "3", "1"]
    assert any("even scores" in note for note in rubric["notes"])
    followup = parse_rubric(specs["judge.followup_resolution"].system, "Anchors")
    assert followup["groups"][0]["key"] is None and len(followup["groups"][0]["anchors"]) == 5
    verdicts = parse_rubric(specs["judge.claims_verify"].system, "Verdicts")
    labels = [a["label"] for a in verdicts["groups"][0]["anchors"]]
    assert labels == ["supported", "contradicted", "not_found"]
    behaviours = parse_rubric(specs["judge.behavior"].system, "Behaviours")
    assert {a["label"] for a in behaviours["groups"][0]["anchors"]} == set(
        REVIEWABLE["behavior_correct"].choices or ()
    )


def test_grade_values() -> None:
    def value(metric: str, grade: Grade, expected: str = "answer") -> tuple:
        return grade_value(REVIEWABLE[metric], grade, expected_behavior=expected,
                           claim_ids=[1, 2])  # fmt: skip

    assert value("answer_quality.correctness", Grade("x", "4"))[:2] == (0.75, "4")
    assert value("answer_quality", Grade("x", "borderline"))[:2] == (0.5, "borderline")
    assert value("answer_quality.relevance", Grade("x", None)) == (None, None, None)  # n/a
    assert value("behavior_correct", Grade("x", "abstained"))[:2] == (0.0, "abstained")
    assert value("behavior_correct", Grade("x", "abstained"), "refuse")[:2] == (1.0, "abstained")
    verdicts = {"1": "supported", "2": "contradicted"}
    assert value("faithfulness", Grade("x", claim_verdicts=verdicts)) == (0.5, None, verdicts)
    for metric, grade in [
        ("answer_quality.correctness", Grade("x", "6")),
        ("behavior_correct", Grade("x", "pass")),
        ("faithfulness", Grade("x", claim_verdicts={"1": "supported"})),  # claim 2 missing
        ("faithfulness", Grade("x", claim_verdicts={"1": "yes", "2": "supported"})),
    ]:
        with pytest.raises(ApiError) as caught:
            value(metric, grade)
        assert caught.value.code == "bad_grade"


def test_categories_round_judge_medians() -> None:
    spec = REVIEWABLE["answer_quality.completeness"]
    assert [spec.category(v) for v in (0.0, 0.25, 0.375, 0.75, 1.0)] == [0, 1, 2, 3, 4]
    assert REVIEWABLE["answer_quality"].label_of(0.5) == "borderline"
    assert REVIEWABLE["behavior_correct"].label_of(1.0) == "pass"
    assert REVIEWABLE["faithfulness"].category(0.5) is None
    assert set(calibration.REVIEW_PROMPTS) == {
        "judge.answer_quality", "judge.followup_resolution", "judge.behavior",
        "judge.claims_verify",
    }  # fmt: skip
