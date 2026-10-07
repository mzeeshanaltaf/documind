"""Document metadata: deterministic header values first, an LLM for the rest.

Two background-tier calls run concurrently: `classify` (department, jurisdiction, doc_type and
a fallback title/entity) and `summarize` (2–3 sentences). Header values win over LLM values
for fields both provide; admins can edit everything afterwards.
"""

import asyncio
import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from app.ingestion.chunker import count_tokens
from app.ingestion.parser import ParsedDocument
from app.llm import client as llm
from app.llm.usage import UsageCtx

DEPARTMENTS = (
    "HR",
    "IT",
    "Finance",
    "Procurement",
    "Facilities",
    "Compliance",
    "Corporate",
    "International",
    "Legal",
    "Operations",
    "Other",
)
DOC_TYPES = (
    "policy_manual",
    "country_supplement",
    "global_supplement",
    "overview",
    "procedure",
    "other",
)
GLOBAL = "GLOBAL"
JURISDICTION_RE = re.compile(r"^(?:[A-Z]{2}|GLOBAL)$")
JURISDICTION_ALIASES = {"UK": "GB", "USA": "US", "WORLDWIDE": GLOBAL, "GLOBAL": GLOBAL}

EXCERPT_TOKENS = 1500
MAX_OUTLINE_ITEMS = 80


def normalize_jurisdiction(value: str | None) -> str | None:
    """ISO-3166 alpha-2 (UK → GB) or GLOBAL; None for anything unrecognizable."""
    if not value:
        return None
    code = JURISDICTION_ALIASES.get(value.strip().upper(), value.strip().upper())
    return code if JURISDICTION_RE.match(code) else None


@dataclass
class DocumentMetadata:
    title: str
    legal_entity: str | None = None
    doc_code: str | None = None
    department: str | None = None
    jurisdiction: str | None = None
    doc_type: str | None = None
    version: str | None = None
    effective_date: date | None = None
    review_cycle: str | None = None
    owner: str | None = None
    approved_by: str | None = None
    applies_to: str | None = None
    related_doc_codes: list[str] = field(default_factory=list)
    summary: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


CLASSIFY_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "name": "document_classification",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "department": {"type": "string", "enum": list(DEPARTMENTS)},
            "jurisdiction": {
                "type": "string",
                "description": "ISO-3166 alpha-2 country code (GB, not UK) or GLOBAL.",
            },
            "doc_type": {"type": "string", "enum": list(DOC_TYPES)},
            "title": {"type": ["string", "null"]},
            "legal_entity": {"type": ["string", "null"]},
        },
        "required": ["department", "jurisdiction", "doc_type", "title", "legal_entity"],
    },
}

SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "name": "document_summary",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"summary": {"type": "string"}},
        "required": ["summary"],
    },
}

CLASSIFY_INSTRUCTIONS = f"""\
You classify company policy documents for a document search system.
Return:
- department: the owning function. One of: {", ".join(DEPARTMENTS)}. Use International for
  documents about operating across countries that span several functions; Corporate for
  company-wide overviews; Compliance for ethics/compliance codes.
- jurisdiction: where the document applies, decided from "Applies to" and the content.
  A two-letter ISO-3166 code (US, PK, DE, FR, AU, GB; use GB, never UK) when it covers one
  country only (e.g. "All U.S. employees", or a country HR manual). GLOBAL when it applies to
  the company and its subsidiaries in several countries, or company-wide with no single country.
- doc_type: policy_manual (a function's main company manual), country_supplement (the local
  rules for one country's entity or employees that sit alongside a main manual — e.g. a
  "Germany HR Manual" or "United Kingdom HR Manual" next to the HR Policy Manual — even when
  titled "Manual"), global_supplement (cross-country rules that supplement main manuals),
  overview (company overview/profile), procedure (step-by-step procedure), other.
- title: the document's title without the company name, or null if the provided title is
  already known. legal_entity: the issuing legal entity (e.g. "Simtora Technologies GmbH"), or null.
"""

SUMMARY_INSTRUCTIONS = """\
Write a 2–3 sentence summary of this company document for a document catalog: what it covers
(its main topics) and who it applies to. Plain prose, no bullet points, no marketing tone.
"""


def title_from_lines(title_lines: list[str]) -> tuple[str | None, str | None]:
    """Page-1 title lines → (legal_entity, title).
    Two lines: entity then title. One line with " – ": split it. Otherwise unknown."""
    lines = [line.strip() for line in title_lines if line.strip()]
    if len(lines) >= 2:
        return lines[0], " ".join(lines[1:])
    if len(lines) == 1 and " – " in lines[0]:
        entity, title = lines[0].split(" – ", 1)
        return entity.strip(), title.strip()
    return None, None


def _jsonable(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else value


def build_llm_input(parsed: ParsedDocument, file_name: str) -> str:
    header = {k: _jsonable(v) for k, v in parsed.header.items() if v not in (None, "", [])}
    outline = [
        "  " * (item["level"] - 1)
        + f"{item['number'] or ''} {item['title']} (p.{item['page']})".strip()
        for item in parsed.outline[:MAX_OUTLINE_ITEMS]
    ]
    excerpt: list[str] = []
    used = 0
    for block in parsed.blocks:
        if block.page == 1 and block.text in parsed.title_lines:
            continue
        tokens = count_tokens(block.text)
        if used + tokens > EXCERPT_TOKENS:
            break
        excerpt.append(block.text)
        used += tokens
    return "\n\n".join(
        [
            f"File name: {file_name}",
            f"Title lines (page 1): {json.dumps(parsed.title_lines, ensure_ascii=False)}",
            f"Header table: {json.dumps(header, ensure_ascii=False)}",
            "Outline:\n" + ("\n".join(outline) or "(none)"),
            "Opening text:\n" + "\n\n".join(excerpt),
        ]
    )


def merge_metadata(
    parsed: ParsedDocument, classification: dict[str, Any], summary: str | None, file_name: str
) -> DocumentMetadata:
    """Combine header (wins), page-1 title lines, and LLM output into document fields."""
    header = parsed.header
    entity, title = title_from_lines(parsed.title_lines)
    llm_title = (classification.get("title") or "").strip() or None
    fallback_title = Path(file_name).stem.replace("-", " ").replace("_", " ").strip()
    department = classification.get("department")
    doc_type = classification.get("doc_type")
    return DocumentMetadata(
        title=title or llm_title or " ".join(parsed.title_lines) or fallback_title,
        legal_entity=entity or (classification.get("legal_entity") or "").strip() or None,
        doc_code=header.get("doc_code"),
        department=department if department in DEPARTMENTS else "Other",
        jurisdiction=normalize_jurisdiction(classification.get("jurisdiction")) or GLOBAL,
        doc_type=doc_type if doc_type in DOC_TYPES else "other",
        version=header.get("version"),
        effective_date=header.get("effective_date"),
        review_cycle=header.get("review_cycle"),
        owner=header.get("owner"),
        approved_by=header.get("approved_by"),
        applies_to=header.get("applies_to"),
        related_doc_codes=header.get("related_doc_codes") or [],
        summary=(summary or "").strip() or None,
    )


async def extract_metadata(
    parsed: ParsedDocument,
    file_name: str,
    *,
    model: str,
    tier: str,
    org_id: str,
    document_id: uuid.UUID,
    user_id: str | None = None,
) -> DocumentMetadata:
    ctx = UsageCtx(org_id=org_id, user_id=user_id, document_id=document_id)
    prompt = build_llm_input(parsed, file_name)
    (classify_response, _), (summary_response, _) = await asyncio.gather(
        llm.respond(
            model=model,
            input=prompt,
            instructions=CLASSIFY_INSTRUCTIONS,
            text_format=CLASSIFY_SCHEMA,
            tier=tier,
            operation="classify",
            ctx=ctx,
        ),
        llm.respond(
            model=model,
            input=prompt,
            instructions=SUMMARY_INSTRUCTIONS,
            text_format=SUMMARY_SCHEMA,
            tier=tier,
            operation="summarize",
            ctx=ctx,
        ),
    )
    classification = json.loads(classify_response.output_text)
    summary = json.loads(summary_response.output_text).get("summary")
    return merge_metadata(parsed, classification, summary, file_name)
