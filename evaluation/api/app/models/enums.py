"""Enum values kept as text + CHECK constraints (see docs/plan/eval/README.md › Data model).
Adding a value needs a migration that replaces the CHECK."""

from typing import Literal, get_args

DatasetKind = Literal["golden", "synthetic", "adversarial", "mixed"]
VersionStatus = Literal["draft", "published"]
CaseType = Literal[
    "single_hop",
    "multi_hop",
    "jurisdiction",
    "comparative",
    "unanswerable",
    "out_of_scope",
    "clarification",
    "injection",
    "leakage",
    "jurisdiction_confusion",
    "multi_turn",
    "authz_probe",
]
ExpectedBehavior = Literal[
    "answer", "refuse", "clarify", "clarify_or_variations", "answer_ignoring_injection"
]
CaseSource = Literal["manual", "imported", "synthetic", "adversarial"]
Difficulty = Literal["easy", "medium", "hard"]
PromptKind = Literal["judge", "generator"]
RunMode = Literal["full", "retrieval_only"]
RunStatus = Literal[
    "running", "pausing", "paused", "stopping", "stopped", "finalizing", "completed", "failed"
]
RunCaseStatus = Literal["pending", "generating", "generated", "judging", "done", "error", "skipped"]
# `chat` = scores of a full run's answer turn; the others are retrieval-only modes.
MetricMode = Literal["chat", "bm25", "vector", "hybrid"]
RetrievalMode = Literal["bm25", "vector", "hybrid"]
MetricStatus = Literal["ok", "na", "error", "refusal"]
ClaimVerdict = Literal["supported", "contradicted", "not_found"]
JudgeCallStatus = Literal["ok", "error", "refusal"]
CiMethod = Literal["bootstrap", "wilson"]
JobKind = Literal[
    "noop",
    "case_generate",
    "case_judge",
    "run_finalize",
    "synthetic_generate",  # E7
    "authz_probe",  # E8
    "calibration_compute",  # E9
]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
# E7: synthetic test sets.
BatchKind = Literal["synthetic", "enrichment"]
BatchStatus = Literal["generating", "paused", "review"]
SyntheticType = Literal[
    "single_hop", "multi_hop", "jurisdiction", "comparative", "unanswerable", "out_of_scope"
]
CandidateStatus = Literal["pending", "approved", "rejected"]
CandidateGenStatus = Literal["queued", "generated", "failed"]


def values(literal: object) -> tuple[str, ...]:
    return get_args(literal)
