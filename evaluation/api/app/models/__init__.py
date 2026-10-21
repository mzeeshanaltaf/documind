"""SQLAlchemy models. Importing this package registers every table on `metadata`."""

from app.models.base import Base, metadata
from app.models.dataset import Case, Dataset, DatasetVersion
from app.models.job import Job
from app.models.offline import OfflineTask
from app.models.prompt import ConfigPreset, Prompt, PromptVersion
from app.models.review import Calibration, Review, ReviewItem, ReviewQueue
from app.models.run import (
    Claim,
    JudgeCall,
    MetricScore,
    RetrievedContext,
    Run,
    RunAggregate,
    RunCase,
)
from app.models.synthetic import SyntheticBatch, SyntheticCandidate

__all__ = [
    "Base",
    "Calibration",
    "Case",
    "Claim",
    "ConfigPreset",
    "Dataset",
    "DatasetVersion",
    "Job",
    "JudgeCall",
    "MetricScore",
    "OfflineTask",
    "Prompt",
    "PromptVersion",
    "RetrievedContext",
    "Review",
    "ReviewItem",
    "ReviewQueue",
    "Run",
    "RunAggregate",
    "RunCase",
    "SyntheticBatch",
    "SyntheticCandidate",
    "metadata",
]
