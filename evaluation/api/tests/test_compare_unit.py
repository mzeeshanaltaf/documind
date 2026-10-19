"""Compare and trends logic that needs no database: the config diff, change markers, the
comparison builder and A/A pair detection."""

import copy
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import config_diff
from app.services.compare import CaseValues, build_comparison, fingerprint, pick_aa_pair
from app.services.trends import RunFacts, change_markers

CONFIG: dict[str, Any] = {
    "dataset_version_id": "v1",
    "org_id": "org",
    "org_slug": "simtora",
    "mode": "retrieval_only",
    "overrides": {},
    "retrieval_modes": ["hybrid"],
    "effective": {"top_k": 8, "router_model": "gpt-6-luna"},
    "metrics": {"enabled": None, "thresholds": {}, "gates": None},
    "judge": {"enabled": False},
    "cleanup_conversations": True,
}
SNAPSHOT: dict[str, Any] = {
    "documind": {
        "version": "aaa111",
        "info": {"version": "aaa111", "prompt_hashes": {"router": "r1"}},
    },
    "org": {"settings": {"top_k": 8}},
    "documents": {"count": 2, "ids": ["1", "2"], "by_code": {"SIM-HR-001": "1", "SIM-HR-002": "2"}},
    "dataset": {"slug": "golden", "version": 1, "content_hash": "h1", "version_id": "v1"},
    "prompts": {"judge.behavior": {"version_id": "p1", "sha256": "beef" * 16, "version": 1}},
    "eval": {"git_sha": "e1"},
}


def variant(**changes: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """A copy of CONFIG/SNAPSHOT with path changes (`config__x__y=…` / `snapshot__x__y=…`)."""
    config, snapshot = copy.deepcopy(CONFIG), copy.deepcopy(SNAPSHOT)
    for path, value in changes.items():
        root, *keys = path.split("__")
        target = config if root == "config" else snapshot
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
    return config, snapshot


# --- config diff -----------------------------------------------------------------------------


def test_flatten_keeps_lists_and_drops_empty_dicts() -> None:
    assert config_diff.flatten({"a": {"b": 1, "c": {}}, "d": [1, 2]}) == {"a.b": 1, "d": [1, 2]}


def test_a_missing_key_equals_an_explicit_none() -> None:
    old = config_diff.flatten({"judge": {"enabled": True}})
    new = config_diff.flatten({"judge": {"enabled": True, "models": {"rubric": None}}})
    assert config_diff.diff(old, new) == []
    changed = config_diff.flatten({"judge": {"enabled": True, "models": {"rubric": "x"}}})
    assert [d.as_dict() for d in config_diff.diff(old, changed)] == [
        {"key": "judge.models.rubric", "a": None, "b": "x"}
    ]


def test_config_diff_shows_the_top_k_override() -> None:
    a = config_diff.comparable("retrieval_only", CONFIG, SNAPSHOT)
    config, snapshot = variant(config__overrides={"top_k": 4}, config__effective__top_k=4)
    b = config_diff.comparable("retrieval_only", config, snapshot)
    assert [d.as_dict() for d in config_diff.diff(a, b)] == [
        {"key": "config.effective.top_k", "a": 8, "b": 4},
        {"key": "config.overrides.top_k", "a": None, "b": 4},
    ]


def test_config_diff_reads_the_snapshot_and_skips_where_a_run_ran() -> None:
    a = config_diff.comparable("full", CONFIG, SNAPSHOT)
    config, snapshot = variant(
        config__dataset_version_id="v2",  # covered by dataset.version
        config__cleanup_conversations=False,  # doesn't shape results
        snapshot__documind__version="bbb222",
        snapshot__dataset__version=2,
        snapshot__prompts={
            "judge.behavior": {"version_id": "p2", "sha256": "cafe" * 16, "version": 2}
        },
    )
    b = config_diff.comparable("full", config, snapshot)
    keys = {d.key: (d.a, d.b) for d in config_diff.diff(a, b)}
    assert keys == {
        "documind.version": ("aaa111", "bbb222"),
        "dataset.version": (1, 2),
        "judge_prompts.judge.behavior": ("v1 · beefbeef", "v2 · cafecafe"),
    }
    assert config_diff.diff(a, a) == []
    assert "documents.codes" in a and "documents.ids" not in a


# --- change markers --------------------------------------------------------------------------


def facts(i: int, config_hash: str = "c1", **changes: Any) -> RunFacts:
    config, snapshot = variant(**changes)
    return RunFacts(
        run_id=uuid.UUID(int=i),
        finished_at=datetime(2026, 10, 19, tzinfo=UTC) + timedelta(hours=i),
        mode="full",
        config=config,
        config_hash=config_hash,
        snapshot=snapshot,
    )


def test_change_markers_between_consecutive_runs() -> None:
    prompt_v2 = {"judge.behavior": {"version_id": "p2", "sha256": "cafe" * 16, "version": 2}}
    runs = [
        facts(1),
        facts(2),  # identical: no marker
        facts(3, snapshot__prompts=prompt_v2),  # a judge prompt edit
        facts(4, snapshot__prompts=prompt_v2, snapshot__documind__version="bbb222"),  # redeploy
        facts(
            5,
            "c2",
            snapshot__prompts=prompt_v2,
            snapshot__documind__version="bbb222",
            config__overrides={"top_k": 4},
            config__effective__top_k=4,
        ),
        facts(
            6,
            "c3",
            snapshot__prompts=prompt_v2,
            snapshot__documind__version="bbb222",
            config__overrides={"top_k": 4},
            config__effective__top_k=4,
            config__dataset_version_id="v2",
            snapshot__dataset__version=2,
            snapshot__dataset__content_hash="h2",
        ),
    ]
    markers = change_markers(runs)
    assert [(m["run_id"].int, m["previous_run_id"].int, m["kinds"]) for m in markers] == [
        (3, 2, ["prompt"]),
        (4, 3, ["documind"]),
        (5, 4, ["config"]),
        (6, 5, ["dataset"]),
    ]
    assert markers[0]["changes"] == [
        {
            "kind": "prompt",
            "key": "judge_prompts.judge.behavior",
            "a": "v1 · beefbeef",
            "b": "v2 · cafecafe",
        }
    ]
    assert {c["key"] for c in markers[2]["changes"]} == {
        "config.effective.top_k",
        "config.overrides.top_k",
    }
    assert change_markers(runs[:1]) == [] and change_markers([]) == []


def test_an_unexplained_config_hash_change_still_marks() -> None:
    markers = change_markers([facts(1, "c1"), facts(2, "c9")])
    assert markers[0]["changes"] == [{"kind": "config", "key": "config_hash", "a": "c1", "b": "c9"}]


# --- comparison builder ----------------------------------------------------------------------


def case(key: str, position: int, status: str = "done", **values: float | None) -> CaseValues:
    return CaseValues(
        uuid.uuid4(), key, f"Question {key}?", "single_hop", position, status, None, dict(values)
    )


def test_build_comparison_pairs_classifies_and_adjusts() -> None:
    a = {
        "c1": case("c1", 1, mrr=1.0, leakage=0.0, latency_ms=1000),
        "c2": case("c2", 2, mrr=0.5, leakage=0.0, latency_ms=1000),
        "c3": case("c3", 3, mrr=0.2, leakage=0.0, latency_ms=1000),
        "c4": case("c4", 4, status="error"),
        "c5": case("c5", 5, mrr=1.0),
    }
    b = {
        "c1": case("c1", 1, mrr=1.0, leakage=0.0, latency_ms=3000),  # only latency moved
        "c2": case("c2", 2, mrr=1.0, leakage=1.0, latency_ms=1000),  # mrr up, leakage appeared
        "c3": case("c3", 3, mrr=0.5, leakage=0.0, latency_ms=1000),
        "c4": case("c4", 4, mrr=1.0),
        "c6": case("c6", 6, mrr=0.0),
    }
    result = build_comparison("A", "B", a, b, noise={"mrr": 0.05})
    rows = {r["key"]: r for r in result["metrics"]}
    assert list(rows) == ["mrr", "latency_ms", "leakage"]  # registry order
    mrr = rows["mrr"]
    assert (mrr["n"], mrr["test"], mrr["delta"]) == (3, "permutation", pytest.approx(0.8 / 3))
    assert mrr["direction_good"] is True and mrr["within_noise"] is False
    assert mrr["p"] == pytest.approx(0.5)  # diffs 0.5, 0.3 (and a 0): |±0.5 ±0.3| ≥ 0.8 in 2 of 4
    leakage = rows["leakage"]
    assert leakage["test"] == "mcnemar" and leakage["discordant"] == {"a_only": 0, "b_only": 1}
    assert leakage["direction_good"] is False  # lower is better
    assert mrr["in_family"] and leakage["in_family"]
    assert all(r["p_holm"] >= r["p"] for r in rows.values() if r["in_family"])
    # Operational metrics are descriptive: a CI and a raw p, no Holm, never significant.
    latency = rows["latency_ms"]
    assert latency["in_family"] is False and latency["p_holm"] is None
    assert latency["p"] is not None and latency["ci"] is not None
    assert not any(r["significant"] for r in rows.values())

    by_key = {c["case_key"]: c for c in result["cases"]}
    assert [c["case_key"] for c in result["cases"]] == ["c1", "c2", "c3", "c4", "c5", "c6"]
    assert by_key["c1"]["class"] == "unchanged"  # latency doesn't classify
    assert by_key["c2"]["class"] == "mixed"
    assert by_key["c2"]["changes"] == {"mrr": "improved", "leakage": "regressed"}
    assert by_key["c3"]["class"] == "improved" and by_key["c3"]["deltas"]["mrr"] == pytest.approx(
        0.3
    )
    assert by_key["c4"]["class"] == "unpaired" and by_key["c4"]["status_a"] == "error"
    assert by_key["c5"]["status_b"] is None and by_key["c6"]["status_a"] is None
    assert result["pairing"] == {
        "paired": 3,
        "only_a": 1,
        "only_b": 1,
        "not_done": 1,
        "classes": {"improved": 1, "regressed": 0, "mixed": 1, "unchanged": 1, "unpaired": 3},
        "flip_rate": pytest.approx(2 / 3),
    }


def test_build_comparison_counts_na_and_keeps_requested_metrics() -> None:
    a = {"c1": case("c1", 1, faithfulness=None, mrr=1.0), "c2": case("c2", 2, mrr=1.0)}
    b = {"c1": case("c1", 1, faithfulness=0.9, mrr=1.0), "c2": case("c2", 2, mrr=1.0)}
    result = build_comparison("A", "B", a, b, ["mrr", "faithfulness"])
    rows = {r["key"]: r for r in result["metrics"]}
    assert rows["faithfulness"]["n"] == 0 and rows["faithfulness"]["n_missing"] == 1
    assert rows["faithfulness"]["delta"] is None and rows["faithfulness"]["p_holm"] is None
    assert rows["mrr"]["p"] == 1.0 and rows["mrr"]["direction_good"] is None
    assert result["pairing"]["flip_rate"] == 0


# --- A/A pairs -------------------------------------------------------------------------------


def run(i: int, config_hash: str = "c1", version: str = "d1") -> Any:
    return SimpleNamespace(
        id=uuid.UUID(int=i),
        config_hash=config_hash,
        snapshot={"documind": {"version": version}, "prompts": {"p": {"sha256": "s"}}},
    )


def test_pick_aa_pair_takes_the_newest_matching_pair() -> None:
    r1, r2, r3, r4 = run(1), run(2, "c2"), run(3), run(4, "c2", "d2")
    first, second = pick_aa_pair([r4, r3, r2, r1], exclude=set())  # newest first
    assert (first.id, second.id) == (r1.id, r3.id)  # older is A
    assert pick_aa_pair([r4, r2], exclude=set()) is None  # same hash, different DocuMind


def test_an_aa_pair_being_compared_is_its_own_floor() -> None:
    r1, r2, r3, r4 = run(1, "x"), run(2, "x"), run(3), run(4)
    same = [fingerprint(r4), fingerprint(r3)]
    # A/A runs r3, r4 compared: their own pair beats an older pair with another setup.
    first, second = pick_aa_pair([r4, r3, r2, r1], exclude={r3.id, r4.id}, prefer=same)
    assert {first.id, second.id} == {r3.id, r4.id}
    # A third run of the same setup stands in for one of them.
    r5 = run(5)
    first, second = pick_aa_pair([r5, r4, r3, r2, r1], exclude={r5.id, r4.id}, prefer=same)
    assert {first.id, second.id} == {r3.id, r5.id}


def test_pick_aa_pair_prefers_the_compared_setup() -> None:
    r1, r2, r3, r4, r5 = run(1, "x"), run(2, "x"), run(3), run(4), run(5, "y")
    candidates = [r5, r4, r3, r2, r1]
    first, second = pick_aa_pair(candidates, exclude=set())
    assert {first.id, second.id} == {r3.id, r4.id}  # newest group with two runs
    first, second = pick_aa_pair(candidates, exclude={r5.id, r1.id}, prefer=[fingerprint(r1)])
    assert {first.id, second.id} == {r1.id, r2.id}  # B's (r1's) setup wins over newer ones
