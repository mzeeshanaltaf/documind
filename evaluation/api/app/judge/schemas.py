"""Structured outputs of the judge prompts. A prompt file names its class in `schema:`; the class
becomes the request's `output_config.format` (via `anthropic.transform_schema`) and validates the
reply. Reasoning fields come **before** verdicts and scores, so the model reasons first."""

from typing import Literal

from pydantic import BaseModel, Field

Score = Literal[1, 2, 3, 4, 5]
Dimension = Literal[
    "correctness", "completeness", "relevance", "jurisdiction_handling", "refusal_helpfulness"
]


class ExtractedClaim(BaseModel):
    text: str = Field(description="One atomic factual claim, self-contained.")
    sentence_idx: int = Field(description="0-based index of the answer sentence it comes from.")
    citation_ns: list[int] = Field(description="The [n] markers attached to that sentence.")


class ClaimsExtract(BaseModel):
    claims: list[ExtractedClaim]


class ClaimVerdict(BaseModel):
    idx: int
    reasoning: str
    verdict: Literal["supported", "contradicted", "not_found"]
    supporting_ns: list[int] = Field(description="Source numbers that support the claim.")
    evidence_quote: str = Field(description="A short verbatim quote from a source, or ''.")


class ClaimsVerify(BaseModel):
    verdicts: list[ClaimVerdict]


class FactVerdict(BaseModel):
    idx: int
    reasoning: str
    entailed: Literal["yes", "partial", "no"]


class KeyFacts(BaseModel):
    facts: list[FactVerdict]


class ChunkRelevance(BaseModel):
    n: int
    reasoning: str
    relevant: bool


class ContextRelevance(BaseModel):
    chunks: list[ChunkRelevance]


class Behavior(BaseModel):
    reasoning: str
    behavior: Literal["answered", "abstained", "clarified", "partial", "followed_injection"]
    mentions_owner: bool
    followed_injected_instruction: bool


class QualityAnalysis(BaseModel):
    correctness: str
    completeness: str
    relevance: str
    jurisdiction_handling: str
    refusal_helpfulness: str


class QualityScores(BaseModel):
    correctness: Score | None
    completeness: Score | None
    relevance: Score | None
    jurisdiction_handling: Score | None
    refusal_helpfulness: Score | None


class QualityIssue(BaseModel):
    severity: Literal["minor", "major", "critical"]
    dimension: Dimension
    quote: str
    explanation: str


class AnswerQuality(BaseModel):
    analysis: QualityAnalysis
    scores: QualityScores
    verdict: Literal["pass", "borderline", "fail"]
    summary: str
    issues: list[QualityIssue]


class FollowupResolution(BaseModel):
    reasoning: str
    resolved: bool
    score: Score


# --- generator prompts (E7) ----------------------------------------------------------------------


class GeneratedFact(BaseModel):
    fact: str = Field(description="One atomic fact a complete answer must convey.")
    weight: Literal[1, 2, 3] = Field(description="3 = essential, 2 = important, 1 = detail.")


class GeneratedCase(BaseModel):
    rationale: str = Field(
        description="Which passage answers the question and what the case tests, written first."
    )
    question: str
    reference_answer: str
    key_facts: list[GeneratedFact]
    evidence_quotes: list[str] = Field(
        description="Short verbatim quotes from the chunks that carry the answer; [] if none."
    )
    expected_doc_codes: list[str]
    expected_sections: list[str] = Field(description='"CODE §number" taken from chunk headers.')
    expected_jurisdiction: str | None = Field(description="Country code, or null.")
    expected_behavior: Literal["answer", "refuse"]


class CandidateValidation(BaseModel):
    reasoning: str
    answerable_from_sources: bool
    reference_supported: bool = Field(
        description="The reference answer and key facts follow from the sources."
    )
    self_contained: bool
    ambiguity: Literal["low", "medium", "high"]
    issues: list[str]
    keep: bool


class EnrichedReference(BaseModel):
    rationale: str
    reference_answer: str
    key_facts: list[GeneratedFact]
    evidence_quotes: list[str]


SCHEMAS: dict[str, type[BaseModel]] = {
    cls.__name__: cls
    for cls in (
        ClaimsExtract,
        ClaimsVerify,
        KeyFacts,
        ContextRelevance,
        Behavior,
        AnswerQuality,
        FollowupResolution,
        GeneratedCase,
        CandidateValidation,
        EnrichedReference,
    )
}
