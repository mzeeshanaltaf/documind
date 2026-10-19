"""JSONL → cases: field mapping, type inference, department filling, and the golden import.

A mapping is `{target_field: source_key}`. Unmapped target fields read the source key of the
same name, so a file from `GET /v1/dataset-versions/{id}/export` imports with no mapping.
"""

import dataclasses
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.documind.client import DocuMindClient
from app.models import Dataset, DatasetVersion
from app.schemas.datasets import CONTENT_FIELDS, CaseFields, DatasetIn, ImportRowError
from app.services import datasets as service

LIST_FIELDS = frozenset(
    name
    for name, info in CaseFields.model_fields.items()
    if getattr(info.annotation, "__origin__", None) is list
)
MAX_IMPORT_ROWS = 2000


@dataclass
class ImportOptions:
    dataset_slug: str
    dataset_name: str | None = None
    default_org_slug: str | None = None
    kind: str = "mixed"
    mapping: dict[str, str] = field(default_factory=dict)
    defaults: dict[str, Any] = field(default_factory=dict)
    key_prefix: str | None = None  # case keys `<prefix>-001…` when rows have none
    fill_departments: bool = True
    publish: bool = False


@dataclass
class ParsedImport:
    cases: list[CaseFields]
    errors: list[ImportRowError]
    warnings: list[str] = field(default_factory=list)


def infer_type(row: Mapping[str, Any]) -> str:
    """golden.jsonl has no type: a jurisdiction → `jurisdiction`; several expected documents →
    `multi_hop`; otherwise `single_hop`."""
    if row.get("expected_jurisdiction"):
        return "jurisdiction"
    if len(row.get("expected_doc_codes") or []) > 1:
        return "multi_hop"
    return "single_hop"


def map_row(raw: Mapping[str, Any], options: ImportOptions, index: int) -> dict[str, Any]:
    """One source row → case fields (before validation)."""
    unknown = sorted(set(options.mapping) - set(CONTENT_FIELDS))
    if unknown:
        raise ApiError(422, "invalid_mapping", f"Unknown target fields: {', '.join(unknown)}.")
    row: dict[str, Any] = {}
    for target in CONTENT_FIELDS:
        value = raw.get(options.mapping.get(target, target))
        if value is None or value == "":
            value = None if target == "tags" else options.defaults.get(target)
        if value is None:
            continue
        if target in LIST_FIELDS and isinstance(value, str):
            value = [part.strip() for part in value.split("|") if part.strip()]
        row[target] = value
    if default_tags := options.defaults.get("tags"):
        # Default tags are added to a row's own tags, not replaced by them.
        row["tags"] = list(dict.fromkeys([*row.get("tags", []), *default_tags]))
    if not row.get("case_key"):
        prefix = options.key_prefix or options.dataset_slug
        row["case_key"] = f"{prefix}-{index:03d}"
    if not row.get("type"):
        row["type"] = infer_type(row)
    return row


def parse_jsonl(content: str, options: ImportOptions) -> ParsedImport:
    cases: list[CaseFields] = []
    errors: list[ImportRowError] = []
    seen: set[str] = set()
    lines = [(n, line) for n, line in enumerate(content.splitlines(), start=1) if line.strip()]
    if len(lines) > MAX_IMPORT_ROWS:
        raise ApiError(413, "too_many_rows", f"At most {MAX_IMPORT_ROWS} rows per import.")
    for index, (line_no, line) in enumerate(lines, start=1):
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(ImportRowError(line=line_no, message=f"Invalid JSON: {exc.msg}"))
            continue
        if not isinstance(raw, dict):
            errors.append(ImportRowError(line=line_no, message="Each line must be a JSON object."))
            continue
        try:
            case = CaseFields.model_validate(map_row(raw, options, index))
        except ValidationError as exc:
            message = "; ".join(
                f"{'.'.join(str(p) for p in err['loc']) or 'row'}: {err['msg']}"
                for err in exc.errors()
            )
            errors.append(ImportRowError(line=line_no, message=message))
            continue
        if case.case_key in seen:
            errors.append(
                ImportRowError(line=line_no, message=f"Duplicate case_key {case.case_key!r}.")
            )
            continue
        seen.add(case.case_key)
        cases.append(case)
    if not lines:
        errors.append(ImportRowError(line=0, message="The file has no rows."))
    return ParsedImport(cases=cases, errors=errors)


def fill_departments(cases: Sequence[CaseFields], departments: Mapping[str, str]) -> list[str]:
    """Set `expected_departments` from the expected doc codes where a case has none. Returns
    warnings for codes DocuMind doesn't know."""
    warnings = []
    for case in cases:
        if case.expected_departments or not case.expected_doc_codes:
            continue
        missing = [code for code in case.expected_doc_codes if code not in departments]
        if missing:
            warnings.append(f"{case.case_key}: unknown doc codes {', '.join(missing)}")
        case.expected_departments = list(
            dict.fromkeys(
                departments[code] for code in case.expected_doc_codes if code in departments
            )
        )
    return warnings


async def departments_by_code(documind: DocuMindClient, org_slug: str) -> dict[str, str]:
    """doc_code → department, from the org's documents in DocuMind."""
    me = await documind.me()
    org = next((o for o in me.orgs if o.slug == org_slug), None)
    if org is None:
        raise ApiError(
            422, "unknown_org", f"DocuMind has no org {org_slug!r} visible to the eval service."
        )
    return {
        doc.doc_code: doc.department
        for doc in await documind.documents(org.id)
        if doc.doc_code and doc.department
    }


async def resolve_departments(
    parsed: ParsedImport, options: ImportOptions, documind: DocuMindClient | None
) -> None:
    needs = any(c.expected_doc_codes and not c.expected_departments for c in parsed.cases)
    if not (options.fill_departments and needs):
        return
    if documind is None or not options.default_org_slug:
        parsed.warnings.append("Departments not filled: no DocuMind org to read documents from.")
        return
    try:
        mapping = await departments_by_code(documind, options.default_org_slug)
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001 — DocuMind being down shouldn't block an import
        parsed.warnings.append(f"Departments not filled: DocuMind unavailable ({exc}).")
        return
    parsed.warnings.extend(fill_departments(parsed.cases, mapping))


@dataclass
class ImportResult:
    parsed: ParsedImport
    dataset: Dataset | None = None
    version: DatasetVersion | None = None
    unchanged: bool = False


async def save_import(
    session: AsyncSession, parsed: ParsedImport, options: ImportOptions, created_by: str | None
) -> ImportResult:
    """The cases become a new version of the dataset (created if needed), holding exactly them.
    Re-importing the content of the latest published version is a no-op."""
    if parsed.errors:
        raise ApiError(
            422,
            "invalid_rows",
            f"{len(parsed.errors)} row(s) failed validation; nothing was saved.",
            [error.model_dump() for error in parsed.errors],
        )
    dataset = await session.scalar(select(Dataset).where(Dataset.slug == options.dataset_slug))
    if dataset is None:
        dataset, version = await service.create_dataset(
            session,
            DatasetIn(
                slug=options.dataset_slug,
                name=options.dataset_name or options.dataset_slug,
                default_org_slug=options.default_org_slug,
                kind=options.kind,  # type: ignore[arg-type]
            ),
            created_by,
        )
    else:
        versions = await service.versions_of(session, dataset.id)
        published = next((v for v in versions if v.status == "published"), None)
        if published and published.content_hash == service.content_hash(parsed.cases):
            return ImportResult(parsed=parsed, dataset=dataset, version=published, unchanged=True)
        # An import replaces the cases rather than merging them into a copy of the latest.
        version = await service.create_version(session, dataset, created_by, copy_cases=False)

    await service.add_cases(session, version, parsed.cases)
    if options.publish:
        version = await service.publish_version(session, version.id, created_by)
    return ImportResult(parsed=parsed, dataset=dataset, version=version)


async def import_jsonl(
    session: AsyncSession,
    content: str,
    options: ImportOptions,
    *,
    documind: DocuMindClient | None,
    created_by: str | None,
    preview: bool = False,
) -> ImportResult:
    parsed = parse_jsonl(content, options)
    await resolve_departments(parsed, options, documind)
    if preview:
        return ImportResult(parsed=parsed)
    return await save_import(session, parsed, options, created_by)


# --- the golden set (api/eval/golden.jsonl) ---------------------------------------------------

GOLDEN_OPTIONS = ImportOptions(
    dataset_slug="golden",
    dataset_name="Golden set",
    default_org_slug="simtora",
    kind="golden",
    mapping={"expected_jurisdiction": "jurisdiction"},
    defaults={"expected_behavior": "answer", "tags": ["golden"], "source": "imported"},
    key_prefix="golden",
    publish=True,
)


async def import_golden(
    session: AsyncSession,
    documind: DocuMindClient,
    content: str,
    *,
    created_by: str | None = None,
    org_slug: str = "simtora",
) -> ImportResult:
    """DocuMind's retrieval golden set (`api/eval/golden.jsonl`) as dataset `golden`, published.
    Departments must resolve, so DocuMind has to be reachable."""
    options = dataclasses.replace(GOLDEN_OPTIONS, default_org_slug=org_slug)
    parsed = parse_jsonl(content, options)
    if not parsed.errors:
        mapping = await departments_by_code(documind, org_slug)
        parsed.warnings.extend(fill_departments(parsed.cases, mapping))
    return await save_import(session, parsed, options, created_by)
