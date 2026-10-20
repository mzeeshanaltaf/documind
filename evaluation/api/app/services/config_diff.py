"""What differs between two runs' setups: their config and the parts of the snapshot that can
explain a change in scores (DocuMind's version, prompt hashes and retrieval constants, the org's
settings and documents, the judge prompt versions, the dataset version, the eval commit).

Values are flattened to dotted keys (`config.overrides.top_k`); lists stay whole. Compare (a
key-level diff) and trends (change markers between consecutive runs) both read this.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

# Config keys that describe where a run ran rather than how; the dataset shows up under
# `dataset.*` and the org must match for a comparison anyway.
CONFIG_SKIP = frozenset({"dataset_version_id", "org_id", "org_slug", "cleanup_conversations"})

ChangeKind = Literal["config", "documind", "prompt", "dataset"]


def flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    """`{"a": {"b": 1}, "c": [1, 2], "d": {}}` → `{"a.b": 1, "c": [1, 2]}`. Empty dicts vanish,
    so "no overrides" against "top_k = 4" is one key: `overrides.top_k` None → 4."""
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key in sorted(value, key=str):
            out.update(flatten(value[key], f"{prefix}.{key}" if prefix else str(key)))
        return out
    return {prefix: value}


def comparable(mode: str, config: Mapping[str, Any], snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """The flattened view of one run that a diff reads."""
    documind = snapshot.get("documind") or {}
    info = dict(documind.get("info") or {})
    info.pop("version", None)  # the same value as documind.version
    documents = snapshot.get("documents") or {}
    dataset = snapshot.get("dataset") or {}
    prompts = snapshot.get("prompts") or {}
    view = {
        "mode": mode,
        "config": {k: v for k, v in config.items() if k not in CONFIG_SKIP},
        "documind": {"version": documind.get("version"), **info},
        "org_settings": (snapshot.get("org") or {}).get("settings"),
        "documents": {
            "count": documents.get("count"),
            "codes": sorted((documents.get("by_code") or {}).keys()),
        },
        "judge_prompts": {key: prompt_label(ref) for key, ref in prompts.items()},
        "dataset": {
            "slug": dataset.get("slug"),
            "version": dataset.get("version"),
            "content_hash": dataset.get("content_hash"),
        },
        "eval": snapshot.get("eval") or {},
    }
    return flatten(view)


def prompt_label(ref: Any) -> str | None:
    """`{version, sha256}` → "v3 · 1a2b3c4d"."""
    if not isinstance(ref, Mapping):
        return None
    sha = str(ref.get("sha256") or "")[:8]
    return f"v{ref.get('version')} · {sha}" if sha else f"v{ref.get('version')}"


@dataclass(frozen=True)
class Difference:
    key: str
    a: Any
    b: Any

    def as_dict(self) -> dict[str, Any]:
        return {"key": self.key, "a": self.a, "b": self.b}


def diff(a: Mapping[str, Any], b: Mapping[str, Any]) -> list[Difference]:
    """Keys whose values differ, sorted. A missing key equals an explicit None: older configs
    lack keys that newer ones store as null (`judge.models.rubric`), which isn't a change."""
    out = []
    for key in sorted(set(a) | set(b)):
        left, right = a.get(key), b.get(key)
        if left != right:
            out.append(Difference(key, left, right))
    return out


def kind_of(key: str) -> ChangeKind | None:
    """Which change-marker kind a flattened key belongs to (None: not marked on trends)."""
    if key.startswith(("config.", "mode")):
        return "config"
    if key.startswith("documind.version"):
        return "documind"
    if key.startswith("judge_prompts.") or key == "eval.judge_mode":
        return "prompt"
    if key in ("dataset.slug", "dataset.version"):
        return "dataset"
    return None
