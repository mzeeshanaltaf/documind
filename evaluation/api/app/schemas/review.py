import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ReviewSampling

MAX_QUEUE_SIZE = 200


class QueueIn(BaseModel):
    """A queue over one full run. `metrics[0]` is what stratified sampling buckets by; without a
    `seed` a random one is drawn (and stored)."""

    model_config = ConfigDict(extra="forbid")

    run_id: uuid.UUID
    name: str | None = Field(default=None, max_length=200)
    metrics: list[str] = Field(
        default_factory=lambda: ["answer_quality.correctness"], min_length=1, max_length=10
    )
    sampling: ReviewSampling = "stratified"
    size: int = Field(default=30, ge=1, le=MAX_QUEUE_SIZE)
    blind: bool = True
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)


class Progress(BaseModel):
    total: int
    done: int = Field(description="Items any reviewer finished.")
    skipped: int
    mine_done: int
    mine_skipped: int
    mine_remaining: int
    double_graded: int = Field(description="Items two or more reviewers graded (human κ).")


class QueueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    run_name: str | None = None
    name: str
    metrics: list[str]
    sampling: str
    seed: int
    size: int
    blind: bool
    details: dict[str, Any]
    created_by: str | None
    created_at: datetime
    progress: Progress | None = None


class ItemSummary(BaseModel):
    id: uuid.UUID
    position: int
    status: str
    case_key: str
    run_case_id: uuid.UUID
    reviewers: int
    mine_done: bool
    mine_skipped: bool


class QueueDetailOut(QueueOut):
    items: list[ItemSummary]


class QueueListOut(BaseModel):
    queues: list[QueueOut]


class ItemOut(BaseModel):
    """The case packet, rubric and claims to grade. `judge` is null in a blind queue until this
    reviewer has graded the item (`revealed`); then their grades are `locked`."""

    id: uuid.UUID
    queue_id: uuid.UUID
    position: int
    status: str
    run_id: uuid.UUID
    run_case_id: uuid.UUID
    case_key: str
    case_type: str
    packet: dict[str, Any]
    metrics: list[dict[str, Any]]
    rubrics: dict[str, Any]
    claims: list[dict[str, Any]]
    mine: dict[str, Any]
    revealed: bool
    locked: bool
    judge: dict[str, Any] | None


class NextOut(BaseModel):
    item: ItemOut | None = Field(description="null once this reviewer has no item left.")
    progress: Progress


class GradeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric: str
    label: str | None = Field(
        default=None, max_length=40, description="A score, verdict or behaviour; null = n/a."
    )
    comment: str | None = Field(default=None, max_length=4000)
    claim_verdicts: dict[str, str] | None = Field(
        default=None, description='Faithfulness: claim idx → verdict, e.g. {"1": "supported"}.'
    )


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    queue_id: uuid.UUID
    item_id: uuid.UUID
    grades: list[GradeIn] = Field(min_length=1, max_length=10)


class ReviewOut(BaseModel):
    item: ItemOut
    progress: Progress


class CalibrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    metric: str
    prompt_key: str
    prompt_version: int
    prompt_version_id: uuid.UUID
    judge_model: str
    n: int
    kappa: float | None
    kappa_weighted: float | None
    spearman: float | None
    exact_pct: float | None
    within1_pct: float | None
    mae: float | None
    bias: float | None
    human_kappa: float | None
    confusion: dict[str, Any]
    details: dict[str, Any]
    status: str
    current: bool = Field(description="Matches the prompt file and default model as they are now.")
    computed_at: datetime


class Badge(BaseModel):
    metric: str
    reviewable: bool
    status: str = Field(description="uncalibrated, unreliable, moderate, calibrated or stale")
    n: int
    kappa: float | None = Field(description="κw (κ for nominal scales) of the matching row.")
    primary: str | None
    calibration_id: uuid.UUID | None
    prompt_version: int | None
    judge_model: str | None
    latest: dict[str, Any] | None = Field(description="Stale: the calibration that exists.")


class CalibrationListOut(BaseModel):
    rows: list[CalibrationOut]
    current: list[Badge]
    thresholds: dict[str, float]


class RunCalibrationOut(BaseModel):
    run_id: uuid.UUID
    badges: list[Badge]
