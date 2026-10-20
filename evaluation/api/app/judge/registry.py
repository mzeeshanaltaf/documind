"""Judge prompts as versioned files: `app/judge/prompts/<key>.md`.

A file is YAML frontmatter (`key, kind, role, model, effort, thinking, max_tokens, schema, packet,
include, description`) and a Markdown body. The body before `<!-- task -->` is the **system
prompt**: static, no placeholders, cached across every case of a run. `include: [_rules]`
prepends `_rules.md` (the rules every judge prompt shares). The part after the marker is the
short **task line**, the only place `{{placeholders}}` may appear. `packet` lists the case-packet
sections (`render.SECTIONS`) the prompt sees.

Versioning: sha256 over the key, the normalized system + task, the output JSON schema and the
params.
`sync()` (at startup, and again when a run is created) inserts a `prompt_versions` row for every
new hash, numbered per prompt. Runs record `{key: {version_id, sha256, version}}` in their
snapshot, and judging loads the prompt **from that row**, so editing a file never changes a
run that already started.
"""

import hashlib
import json
import re
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import anthropic
import yaml
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.judge.schemas import SCHEMAS
from app.models import Prompt, PromptVersion

PROMPTS_DIR = Path(__file__).with_name("prompts")
TASK_MARKER = "<!-- task -->"
FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.DOTALL)
PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
SECTIONS = ("question", "conversation", "expected_behavior", "reference", "sources", "answer",
            "routing",
            # Generator prompts (E7): seed chunks, the org's catalog, the candidate under review.
            "chunks", "catalog", "candidate")  # fmt: skip
REQUIRED = ("key", "kind", "role", "model", "schema", "packet")
THINKING = ("adaptive", "disabled")
EFFORTS = ("low", "medium", "high", "xhigh", "max")
# Serializes concurrent syncs (two processes starting at once) so version numbers can't clash.
SYNC_LOCK_ID = 0x6576616C  # "eval"


class PromptFileError(ValueError):
    pass


def normalize(value: str) -> str:
    """LF line endings, no trailing spaces, no leading/trailing blank lines: an editor's
    whitespace changes don't make a new version."""
    lines = [line.rstrip() for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip("\n")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


@dataclass(frozen=True)
class PromptSpec:
    key: str
    kind: str
    role: str
    model: str
    effort: str | None
    thinking: str
    max_tokens: int
    schema_name: str
    packet: tuple[str, ...]
    system: str
    task: str
    output_schema: dict[str, Any] = field(repr=False)
    description: str | None = None
    version_id: uuid.UUID | None = None
    version: int | None = None

    @property
    def params(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "max_tokens": self.max_tokens,
            "schema": self.schema_name,
            "packet": list(self.packet),
        }

    @property
    def body(self) -> str:
        return f"{self.system}\n\n{TASK_MARKER}\n\n{self.task}"

    @property
    def sha256(self) -> str:
        payload = {
            "key": self.key,  # `sha256` is unique across prompts
            "system": self.system,
            "task": self.task,
            "schema": self.output_schema,
            "model": self.model,
            "effort": self.effort,
            "thinking": self.thinking,
            "params": self.params,
        }
        return hashlib.sha256(canonical_json(payload).encode()).hexdigest()

    @property
    def output_model(self) -> type[BaseModel]:
        return SCHEMAS[self.schema_name]

    @property
    def placeholders(self) -> frozenset[str]:
        return frozenset(PLACEHOLDER_RE.findall(self.task))

    def render_task(self, values: dict[str, str] | None = None) -> str:
        values = values or {}
        missing = self.placeholders - values.keys()
        if missing:
            raise KeyError(f"{self.key}: no value for {{{{{', '.join(sorted(missing))}}}}}")
        return PLACEHOLDER_RE.sub(lambda m: values[m.group(1)], self.task)


def output_schema_for(schema_name: str) -> dict[str, Any]:
    try:
        return anthropic.transform_schema(SCHEMAS[schema_name])
    except KeyError as exc:
        raise PromptFileError(f"Unknown output schema {schema_name!r}") from exc


def parse_prompt(source: str, includes: dict[str, str], *, name: str = "<prompt>") -> PromptSpec:
    match = FRONTMATTER_RE.match(normalize(source) + "\n")
    if not match:
        raise PromptFileError(f"{name}: missing YAML frontmatter")
    meta = yaml.safe_load(match.group(1)) or {}
    missing = [key for key in REQUIRED if not meta.get(key)]
    if missing:
        raise PromptFileError(f"{name}: frontmatter lacks {', '.join(missing)}")
    body = match.group(2)
    if body.count(TASK_MARKER) != 1:
        raise PromptFileError(f"{name}: the body needs exactly one {TASK_MARKER} line")
    system, task = (normalize(part) for part in body.split(TASK_MARKER))
    parts = []
    for include in meta.get("include") or []:
        if include not in includes:
            raise PromptFileError(f"{name}: unknown include {include!r}")
        parts.append(normalize(includes[include]))
    system = "\n\n".join([*parts, system])
    if PLACEHOLDER_RE.search(system):
        raise PromptFileError(
            f"{name}: placeholders belong in the task line, not the system prompt"
        )
    packet = tuple(meta["packet"])
    unknown = set(packet) - set(SECTIONS)
    if unknown:
        raise PromptFileError(f"{name}: unknown packet section(s) {sorted(unknown)}")
    thinking = meta.get("thinking", "adaptive")
    effort = meta.get("effort")
    if thinking not in THINKING or (effort is not None and effort not in EFFORTS):
        raise PromptFileError(f"{name}: bad thinking/effort ({thinking!r}, {effort!r})")
    return PromptSpec(
        key=str(meta["key"]),
        kind=str(meta["kind"]),
        role=str(meta["role"]),
        model=str(meta["model"]),
        effort=effort,
        thinking=thinking,
        max_tokens=int(meta.get("max_tokens", 4000)),
        schema_name=str(meta["schema"]),
        packet=packet,
        system=system,
        task=task,
        output_schema=output_schema_for(str(meta["schema"])),
        description=meta.get("description"),
    )


def load_prompts(directory: Path = PROMPTS_DIR) -> dict[str, PromptSpec]:
    """Every `<key>.md` (files starting with `_` are includes)."""
    includes = {path.stem: path.read_text(encoding="utf-8") for path in directory.glob("_*.md")}
    specs: dict[str, PromptSpec] = {}
    for path in sorted(directory.glob("*.md")):
        if path.name.startswith("_"):
            continue
        spec = parse_prompt(path.read_text(encoding="utf-8"), includes, name=path.name)
        if spec.key != path.stem:
            raise PromptFileError(f"{path.name}: key {spec.key!r} must match the file name")
        specs[spec.key] = spec
    return specs


def spec_from_version(key: str, kind: str, row: PromptVersion) -> PromptSpec:
    """A stored version as a spec (what judging uses)."""
    system, task = (part.strip("\n") for part in row.body.split(f"\n\n{TASK_MARKER}\n\n", 1))
    params = row.params or {}
    return PromptSpec(
        key=key,
        kind=kind,
        role=params["role"],
        model=row.model,
        effort=row.effort,
        thinking=row.thinking or "adaptive",
        max_tokens=int(params["max_tokens"]),
        schema_name=params["schema"],
        packet=tuple(params["packet"]),
        system=system,
        task=task,
        output_schema=row.output_schema or {},
        version_id=row.id,
        version=row.version,
    )


def version_ref(spec: PromptSpec) -> dict[str, Any]:
    return {"version_id": str(spec.version_id), "sha256": spec.sha256, "version": spec.version}


async def sync(
    session: AsyncSession, specs: dict[str, PromptSpec] | None = None, *, kind: str | None = None
) -> dict[str, Any]:
    """Make sure every prompt file's current content has a `prompt_versions` row. Returns
    `{key: {version_id, sha256, version}}` for the files as they are now, only the prompts of
    `kind` when given (runs record the judge prompts, synthetic batches the generator ones)."""
    specs = specs if specs is not None else load_prompts()
    refs = await _sync(session, specs)
    return {key: ref for key, ref in refs.items() if kind is None or specs[key].kind == kind}


async def _sync(session: AsyncSession, specs: dict[str, PromptSpec]) -> dict[str, Any]:
    """Two reads (prompts by key, versions by sha) cover the usual case where nothing changed;
    only new or changed prompts and new versions are written. Each query is a VPS round trip,
    so a per-prompt loop of queries made run and batch creation take ~20 s."""
    await session.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": SYNC_LOCK_ID})
    prompts = {
        p.key: p
        for p in (await session.scalars(select(Prompt).where(Prompt.key.in_(list(specs))))).all()
    }
    versions = {
        v.sha256: v
        for v in (
            await session.scalars(
                select(PromptVersion).where(
                    PromptVersion.sha256.in_([s.sha256 for s in specs.values()])
                )
            )
        ).all()
    }
    refs: dict[str, Any] = {}
    for key, spec in specs.items():
        prompt = prompts.get(key)
        if prompt is None or (prompt.kind, prompt.description) != (spec.kind, spec.description):
            await session.execute(
                insert(Prompt)
                .values(id=uuid.uuid4(), key=key, kind=spec.kind, description=spec.description)
                .on_conflict_do_update(
                    index_elements=[Prompt.key],
                    set_={"kind": spec.kind, "description": spec.description},
                )
            )
        row = versions.get(spec.sha256)
        if row is None:
            prompt_id = await session.scalar(select(Prompt.id).where(Prompt.key == key))
            latest = await session.scalar(
                select(func.max(PromptVersion.version)).where(PromptVersion.prompt_id == prompt_id)
            )
            row = PromptVersion(
                id=uuid.uuid4(),
                prompt_id=prompt_id,
                version=(latest or 0) + 1,
                sha256=spec.sha256,
                body=spec.body,
                output_schema=spec.output_schema,
                model=spec.model,
                effort=spec.effort,
                thinking=spec.thinking,
                params=spec.params,
            )
            session.add(row)
            await session.flush()
        refs[key] = {"version_id": str(row.id), "sha256": row.sha256, "version": row.version}
    return refs


_versions: dict[uuid.UUID, PromptSpec] = {}


async def load_version(session: AsyncSession, version_id: uuid.UUID) -> PromptSpec:
    """A stored prompt version (rows are immutable, so they are cached per process)."""
    cached = _versions.get(version_id)
    if cached is not None:
        return cached
    row = (
        await session.execute(
            select(PromptVersion, Prompt.key, Prompt.kind)
            .join(Prompt, Prompt.id == PromptVersion.prompt_id)
            .where(PromptVersion.id == version_id)
        )
    ).one_or_none()
    if row is None:
        raise LookupError(f"Prompt version {version_id} not found")
    spec = spec_from_version(row[1], row[2], row[0])
    _versions[version_id] = spec
    return spec


@lru_cache
def file_specs() -> dict[str, PromptSpec]:
    """The prompt files as loaded once per process (tests and the fake client use them)."""
    return load_prompts()


def file_keys(kind: str) -> set[str]:
    return {key for key, spec in file_specs().items() if spec.kind == kind}
