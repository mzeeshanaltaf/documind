"""The leakage canary (E8): a fictional policy for "Canary Holdings", uploaded to DocuMind as the
org `eval-canary`, that no other org may ever see.

`evaluation/fixtures/canary/canary-policy.md` holds it: YAML frontmatter (org, document code,
header table, `canary_phrases`) and a markdown body that `scripts/make_canary_pdf.py` renders.
Every run snapshots the phrases (`snapshot.canary`), and the `leakage` metric flags any of them
in an answer, source or citation of another org.
"""

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.core.config import get_settings


@dataclass(frozen=True)
class Canary:
    org_slug: str
    org_name: str
    doc_code: str
    title_lines: tuple[str, ...]
    header: dict[str, str]
    phrases: tuple[str, ...]
    body: str
    sha256: str


def parse(text: str) -> Canary:
    """Frontmatter between `---` lines, then the markdown body."""
    if not text.startswith("---"):
        raise ValueError("The canary file needs YAML frontmatter.")
    _, front, body = text.split("---", 2)
    meta: dict[str, Any] = yaml.safe_load(front) or {}
    phrases = tuple(str(p).strip() for p in meta.get("canary_phrases") or [] if str(p).strip())
    if not phrases:
        raise ValueError("The canary file lists no canary_phrases.")
    return Canary(
        org_slug=str(meta["org_slug"]),
        org_name=str(meta["org_name"]),
        doc_code=str(meta["doc_code"]),
        title_lines=tuple(str(line) for line in meta.get("title_lines") or []),
        header={str(k): str(v) for k, v in (meta.get("header") or {}).items()},
        phrases=phrases,
        body=body.strip() + "\n",
        sha256=hashlib.sha256(text.encode()).hexdigest(),
    )


def load(path: Path | None = None) -> Canary:
    return parse((path or get_settings().canary_file).read_text(encoding="utf-8"))


@lru_cache
def current() -> Canary | None:
    """The canary as deployed (None when the fixture is missing: leakage then only checks
    foreign documents and forbidden codes)."""
    path = get_settings().canary_file
    return load(path) if path.exists() else None


def snapshot_for(org_slug: str) -> dict[str, Any]:
    """What a run records: the phrases to look for, unless the run targets the canary org
    itself (its own document isn't a leak there)."""
    canary = current()
    if canary is None:
        return {"phrases": []}
    own = org_slug == canary.org_slug
    return {
        "org_slug": canary.org_slug,
        "doc_code": canary.doc_code,
        "phrases": [] if own else list(canary.phrases),
        "sha256": canary.sha256,
    }
