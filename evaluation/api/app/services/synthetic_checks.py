"""Deterministic checks on a generated candidate (pure functions; E7).

| Check | Rule | Outcome |
|---|---|---|
| `overlap` | share of the question's word trigrams in a seed chunk | ≥ 0.6 copied, ≥ 0.4 warn |
| `duplicate` | token Jaccard ≥ 0.7 vs the target dataset's and batch's questions | hard |
| `sections` | each expected `CODE §n` is a seed chunk's section, each code a seed doc | hard |
| `quotes` | evidence quotes appear verbatim in the excerpts | warn |

Tokens are lowercase alphanumeric words; the Jaccard and title matching drop stop words so
"How many days of leave do I get?" and "How many leave days do I get?" compare as equal.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

WORD_RE = re.compile(r"[a-z0-9]+")
SECTION_RE = re.compile(r"^(?P<code>[A-Z0-9]+(?:-[A-Z0-9]+)*) §(?P<number>[A-Z0-9]+(?:\.[0-9]+)*)$")
STOPWORDS = frozenset(
    "a an and are as at be by can could do does for from get gets how i if in is it its me my "
    "of on or our should so than that the their there they this to us was we what when where "
    "which who whom why will with would you your".split()
)
DUPLICATE_AT = 0.7
COPIED_AT = 0.6
OVERLAP_WARN_AT = 0.4


def words(text: str) -> list[str]:
    return WORD_RE.findall(text.lower())


def content_tokens(text: str) -> set[str]:
    return {word for word in words(text) if word not in STOPWORDS}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def trigrams(tokens: Sequence[str]) -> set[tuple[str, str, str]]:
    return {tuple(tokens[i : i + 3]) for i in range(len(tokens) - 2)}  # type: ignore[misc]


def copy_overlap(question: str, texts: Iterable[str]) -> float:
    """Share of the question's word trigrams that appear in one of the texts (a copied sentence
    scores ~1; a natural paraphrase sharing a term or two ~0.1–0.35)."""
    grams = trigrams(words(question))
    if not grams:
        return 0.0
    best = 0.0
    for text in texts:
        best = max(best, len(grams & trigrams(words(text))) / len(grams))
    return round(best, 4)


@dataclass(frozen=True)
class Duplicate:
    label: str
    question: str
    score: float

    def as_dict(self) -> dict[str, Any]:
        return {"label": self.label, "question": self.question, "score": self.score}


def nearest(question: str, others: Iterable[tuple[str, str]]) -> Duplicate | None:
    """The most similar `(label, question)` by token Jaccard, or None when there are none."""
    tokens = content_tokens(question)
    best: Duplicate | None = None
    for label, other in others:
        score = round(jaccard(tokens, content_tokens(other)), 4)
        if best is None or score > best.score:
            best = Duplicate(label, other, score)
    return best


def section_key(doc_code: str | None, section_number: str | None) -> str | None:
    if not doc_code or not section_number:
        return None
    return f"{doc_code} §{section_number}"


def check_sections(
    expected_sections: Sequence[str],
    expected_doc_codes: Sequence[str],
    excerpts: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Expected sections must be `CODE §n` strings naming a seed chunk's section; expected codes
    must be seed documents, and each section's code must be listed."""
    known = {section_key(e.get("doc_code"), e.get("section_number")) for e in excerpts} - {None}
    codes = {e.get("doc_code") for e in excerpts if e.get("doc_code")}
    malformed = [s for s in expected_sections if not SECTION_RE.match(s)]
    unknown = [s for s in expected_sections if s not in known and s not in malformed]
    unknown_codes = [c for c in expected_doc_codes if c not in codes]
    unlisted = sorted(
        {m["code"] for s in expected_sections if (m := SECTION_RE.match(s))}
        - set(expected_doc_codes)
    )
    return {
        "ok": not (malformed or unknown or unknown_codes or unlisted),
        "malformed": malformed,
        "unknown_sections": unknown,
        "unknown_doc_codes": unknown_codes,
        "unlisted_codes": unlisted,
    }


def _squash(text: str) -> str:
    return " ".join(text.lower().split())


def check_quotes(quotes: Sequence[str], texts: Sequence[str]) -> dict[str, Any]:
    haystack = [_squash(t) for t in texts]
    missing = [q for q in quotes if q.strip() and not any(_squash(q) in h for h in haystack)]
    return {"count": len(quotes), "missing": missing}


@dataclass(frozen=True)
class Verdict:
    """The outcome of every check: hard failures auto-reject, warnings show as chips."""

    failures: tuple[str, ...]
    warnings: tuple[str, ...]

    @property
    def rejected(self) -> bool:
        return bool(self.failures)

    @property
    def reason(self) -> str | None:
        return ", ".join(self.failures) or None


def verdict(checks: Mapping[str, Any], *, answering: bool, enrichment: bool = False) -> Verdict:
    """Hard failures and warnings from a candidate's `checks` (see the module table). The
    validator's `keep=false` is hard for new cases; for enrichment it only warns (the question is
    a reviewed golden case, a human decides)."""
    failures: list[str] = []
    warnings: list[str] = []
    if checks.get("generation_error"):
        failures.append("generation_error")
    overlap = checks.get("overlap")
    if isinstance(overlap, (int, float)):
        if overlap >= COPIED_AT:
            failures.append("copied")
        elif overlap >= OVERLAP_WARN_AT:
            warnings.append("overlap")
    duplicate = checks.get("duplicate") or {}
    if (duplicate.get("score") or 0) >= DUPLICATE_AT:
        failures.append("duplicate")
    sections = checks.get("sections")
    if sections is not None and not sections.get("ok", True):
        failures.append("unknown_section")
    if answering and not enrichment and sections is not None and not checks.get("has_sections"):
        failures.append("no_sections")
    if enrichment and not checks.get("chunk_count"):
        failures.append("no_chunks")
    if checks.get("retrieval_error"):
        failures.append("retrieval_failed")
    validation = checks.get("validation") or {}
    if validation.get("status") == "ok" and validation.get("keep") is False:
        (warnings if enrichment else failures).append("validator_rejected")
    elif validation.get("status") not in (None, "ok"):
        warnings.append("validation_error")
    if validation.get("ambiguity") == "medium":
        warnings.append("ambiguous")
    if (checks.get("quotes") or {}).get("missing"):
        warnings.append("quotes_not_found")
    return Verdict(tuple(failures), tuple(warnings))
