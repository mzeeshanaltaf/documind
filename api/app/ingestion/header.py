"""The policy header table (Document ID, Version, Owner, …) → document metadata."""

import re
from datetime import date
from typing import Any

from dateutil import parser as date_parser

DOC_CODE_RE = re.compile(r"\b[A-Z]{2,5}-[A-Z]{2,5}-\d{2,4}\b")
# "SIM-HR-101 to SIM-HR-105" lists a range of codes; expand it.
DOC_CODE_RANGE_RE = re.compile(
    r"\b([A-Z]{2,5}-[A-Z]{2,5}-)(\d{2,4})\s*(?:to|–|—|-)\s*\1(\d{2,4})\b"
)
MONTH_DATE_RE = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October|November|"
    r"December)\s+\d{1,2},\s+\d{4}\b"
)
MAX_RANGE = 20

HEADER_KEYS = {
    "document id": "doc_code",
    "version": "version",
    "owner": "owner",
    "approved by": "approved_by",
    "effective date": "effective_date",
    "review cycle": "review_cycle",
    "applies to": "applies_to",
    "related manuals": "related_doc_codes",
}


def clean_cell(value: str | None) -> str:
    """Collapse whitespace. A line break after a hyphen joins without a space (`SIM-\\nHR-101`)."""
    if not value:
        return ""
    value = re.sub(r"(?<=\w-)\s*\n\s*", "", value)
    return re.sub(r"\s+", " ", value).strip()


def find_doc_codes(text: str) -> list[str]:
    """Doc codes in order of appearance, deduplicated, with `X-1 to X-5` ranges expanded."""
    codes: list[str] = []
    for match in DOC_CODE_RANGE_RE.finditer(text):
        prefix, start, end = match.group(1), int(match.group(2)), int(match.group(3))
        if 0 < end - start <= MAX_RANGE:
            width = len(match.group(2))
            codes.extend(f"{prefix}{n:0{width}d}" for n in range(start, end + 1))
    codes.extend(DOC_CODE_RE.findall(text))
    return list(dict.fromkeys(codes))


def parse_effective_date(raw: str) -> date | None:
    match = MONTH_DATE_RE.search(raw)
    if not match:
        return None
    try:
        return date_parser.parse(match.group()).date()
    except (ValueError, OverflowError):
        return None


def is_header_table(rows: list[list[str | None]]) -> bool:
    return any(row and clean_cell(row[0]).lower() == "document id" for row in rows)


def parse_header_rows(rows: list[list[str | None]]) -> dict[str, Any]:
    """Map a header table's key/value rows to metadata. Unknown rows go under `other`."""
    header: dict[str, Any] = {}
    other: dict[str, str] = {}
    for row in rows:
        cells = [clean_cell(cell) for cell in row]
        if len(cells) < 2 or not cells[0]:
            continue
        key, value = cells[0], " ".join(cell for cell in cells[1:] if cell)
        field = HEADER_KEYS.get(key.lower())
        if field is None:
            other[key] = value
        elif field == "effective_date":
            header["effective_date"] = parse_effective_date(value)
            header["effective_date_raw"] = value
        elif field == "related_doc_codes":
            header["related_doc_codes"] = value  # resolved below, once doc_code is known
        else:
            header[field] = value

    related = header.get("related_doc_codes")
    if isinstance(related, str):
        header["related_manuals_raw"] = related
        header["related_doc_codes"] = [
            code for code in find_doc_codes(related) if code != header.get("doc_code")
        ]
    if other:
        header["other"] = other
    return header
