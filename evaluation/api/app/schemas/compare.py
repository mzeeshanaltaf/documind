import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.runs import RunOut


class ConfigDifference(BaseModel):
    key: str = Field(description="Flattened, e.g. `config.overrides.top_k`, `judge_prompts.x`.")
    a: Any
    b: Any


class Discordant(BaseModel):
    a_only: int = Field(description="Cases that passed in A only.")
    b_only: int = Field(description="Cases that passed in B only.")


class CompareMetricOut(BaseModel):
    key: str
    group: str
    scale: str
    direction: Literal["higher", "lower"]
    test: Literal["mcnemar", "permutation"]
    n: int = Field(description="Paired cases with an `ok` score on both sides.")
    n_missing: int = Field(description="Paired cases scored on one side only (or n/a).")
    mean_a: float | None
    mean_b: float | None
    delta: float | None = Field(description="B − A.")
    ci: list[float] | None = Field(description="95 % CI of Δ.")
    p: float | None
    in_family: bool = Field(
        description="In the Holm family. Operational metrics (latency, tokens, cost) are not: "
        "they follow the infrastructure (prompt cache, load), so they're descriptive only."
    )
    p_holm: float | None
    significant: bool = Field(description="Holm-adjusted p < 0.05 (family metrics only).")
    direction_good: bool | None = Field(description="Δ points the good way (None: Δ = 0).")
    discordant: Discordant | None = None
    noise_delta: float | None = Field(description="|Δ| of the A/A pair for this metric.")
    within_noise: bool | None


class CompareCaseOut(BaseModel):
    case_key: str
    question: str
    type: str
    run_case_id_a: uuid.UUID | None
    run_case_id_b: uuid.UUID | None
    status_a: str | None
    status_b: str | None
    passed_a: bool | None
    passed_b: bool | None
    values: dict[str, list[float | None]] = Field(description="metric → [A, B].")
    deltas: dict[str, float | None]
    changes: dict[str, Literal["improved", "regressed"]] = Field(
        description="Metrics that moved beyond the per-case band (operational ones excluded)."
    )
    class_: Literal["improved", "regressed", "mixed", "unchanged", "unpaired"] = Field(
        alias="class"
    )


class Pairing(BaseModel):
    paired: int
    only_a: int
    only_b: int
    not_done: int
    classes: dict[str, int]
    flip_rate: float | None = Field(description="Share of paired cases not `unchanged`.")


class NoiseFloor(BaseModel):
    run_a: uuid.UUID
    run_b: uuid.UUID
    is_self: bool = Field(description="The compared runs are themselves the A/A pair.")
    paired: int
    flip_rate: float | None
    metrics: dict[str, float] = Field(description="metric → |Δ| between the A/A runs.")


class CompareOut(BaseModel):
    a: RunOut
    b: RunOut
    mode: str
    config_diff: list[ConfigDifference]
    warnings: list[str]
    noise_floor: NoiseFloor | None
    pairing: Pairing
    metrics: list[CompareMetricOut]
    cases: list[CompareCaseOut]


class TrendPoint(BaseModel):
    run_id: uuid.UUID
    finished_at: datetime | None
    mode: str
    mean: float | None
    ci_low: float | None
    ci_high: float | None
    n: int


class TrendRun(BaseModel):
    run_id: uuid.UUID
    name: str | None
    finished_at: datetime | None
    dataset_version_id: uuid.UUID
    dataset_slug: str
    dataset_version: int | None
    config_hash: str
    documind_version: str | None
    source_run_id: uuid.UUID | None


class MarkerChange(BaseModel):
    kind: Literal["config", "documind", "prompt", "dataset"]
    key: str
    a: Any = Field(description="The previous run's value.")
    b: Any = Field(description="This run's value.")


class TrendMarker(BaseModel):
    run_id: uuid.UUID = Field(description="The first run after the change.")
    previous_run_id: uuid.UUID
    finished_at: datetime | None
    kinds: list[str]
    changes: list[MarkerChange]


class TrendsOut(BaseModel):
    run_mode: str | None = Field(description="full or retrieval_only (default: the newest run's).")
    runs: list[TrendRun] = Field(description="Oldest first.")
    series: dict[str, list[TrendPoint]]
    markers: list[TrendMarker]
    slices: list[str] = Field(description="Slices with aggregates in these runs.")
