"""Creating runs (config, snapshot, cases, jobs), reading them, and deleting them.

A run snapshots everything that could explain a difference between two runs: DocuMind's
version and `/admin/eval/info`, the org's effective settings and documents, the dataset
version's `content_hash`, the eval commit, the judge pricing and the judge prompt versions
(`{key: {version_id, sha256, version}}`; judging loads exactly those). `config_hash` covers the
config that shapes results (not the name, tags, budget or cleanup flag).
"""

import asyncio
import hashlib
import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.security import Admin
from app.documind.client import DocuMindClient
from app.judge import registry
from app.judge.pricing import PRICING_FILE as JUDGE_PRICING_FILE
from app.models import Case, Dataset, DatasetVersion, MetricScore, Run, RunCase
from app.schemas.runs import RETRIEVAL_MODES, RunIn
from app.services import canary, run_state
from app.services import datasets as dataset_service
from app.worker import queue

CASE_ATTEMPTS = 4  # case_generate: 429/5xx/timeouts back off 10 s, 20 s, 40 s
HASH_EXCLUDE = frozenset({"cleanup_conversations"})


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def config_hash(config: dict[str, Any]) -> str:
    hashed = {key: value for key, value in config.items() if key not in HASH_EXCLUDE}
    return hashlib.sha256(canonical_json(hashed).encode()).hexdigest()


def file_sha256(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


def correlation_id(run_id: uuid.UUID, case_key: str) -> str:
    return f"eval:{run_id}:{case_key}"


def eval_snapshot() -> dict[str, Any]:
    return {
        "git_sha": get_settings().git_sha,
        "judge_pricing_sha256": file_sha256(JUDGE_PRICING_FILE),
    }


def effective_settings(settings: dict[str, Any], body: RunIn) -> dict[str, Any]:
    """DocuMind's effective org settings with the run's overrides on top."""
    overrides = body.overrides
    effective = {
        "chat_model": overrides.chat_model or settings.get("chat_model"),
        "router_model": overrides.router_model or settings.get("router_model"),
        "chat_service_tier": overrides.chat_service_tier or settings.get("chat_service_tier"),
        "top_k": overrides.top_k or settings.get("top_k"),
    }
    if body.mode == "full":
        effective["retrieval_mode"] = overrides.retrieval_mode or "hybrid"
    else:
        effective.pop("chat_model")
    return effective


@dataclass(frozen=True)
class ScopeResolution:
    document_ids: list[str]
    missing: list[str]


def resolve_scope(codes: Sequence[str], by_code: dict[str, str]) -> ScopeResolution:
    return ScopeResolution(
        document_ids=[by_code[code] for code in codes if code in by_code],
        missing=[code for code in codes if code not in by_code],
    )


async def create_run(
    session: AsyncSession, body: RunIn, admin: Admin, documind: DocuMindClient
) -> Run:
    version = await dataset_service.get_version_or_404(session, body.dataset_version_id)
    if version.status != "published":
        raise ApiError(409, "version_not_published", "Only published dataset versions can be run.")
    dataset = await dataset_service.get_dataset_or_404(session, version.dataset_id)
    org_slug = body.org_slug or dataset.default_org_slug
    if not org_slug:
        raise ApiError(422, "org_required", "org_slug is required (the dataset has no default).")

    me = await documind.me()
    org = next((o for o in me.orgs if o.slug == org_slug), None)
    if org is None:
        raise ApiError(404, "org_not_found", f"The eval service account can't see {org_slug!r}.")
    health, info, settings, documents = await asyncio.gather(
        documind.health(),
        documind.info(),
        documind.org_settings(org.id),
        documind.documents(org.id),
    )
    by_code = {d.doc_code: d.id for d in documents if d.doc_code}
    cases = await dataset_service.cases_of(session, version.id)
    if not cases:
        raise ApiError(422, "empty_version", "The dataset version has no cases.")

    run_id = uuid.uuid4()
    config: dict[str, Any] = {
        "dataset_version_id": str(version.id),
        "org_id": org.id,
        "org_slug": org.slug,
        "mode": body.mode,
        "overrides": body.overrides.model_dump(exclude_none=True),
        "retrieval_modes": (
            (body.retrieval_modes or list(RETRIEVAL_MODES))
            if body.mode == "retrieval_only"
            else None
        ),
        "effective": effective_settings(settings, body),
        "metrics": body.metrics.model_dump(),
        "judge": body.judge.model_dump(),
        "canary_phrases": body.canary_phrases,
        "cleanup_conversations": body.cleanup_conversations,
    }
    snapshot = {
        "documind": {"version": health.version, "info": info},
        "org": {"id": org.id, "slug": org.slug, "name": org.name, "settings": settings},
        "documents": {
            "count": len(documents),
            "ids": sorted(d.id for d in documents),
            "by_code": by_code,
            # jurisdiction_confusion: which documents are another country's rules.
            "supplements": {
                d.doc_code: d.jurisdiction
                for d in documents
                if d.doc_code and d.jurisdiction and d.doc_type == "country_supplement"
            },
        },
        "canary": canary.snapshot_for(org.slug),
        "dataset": {
            "id": str(dataset.id),
            "slug": dataset.slug,
            "name": dataset.name,
            "version_id": str(version.id),
            "version": version.version,
            "content_hash": version.content_hash,
            "case_count": version.case_count,
        },
        "eval": eval_snapshot(),
        "prompts": await registry.sync(session, kind="judge"),
        "service_user_id": me.user.id,
    }
    run = Run(
        id=run_id,
        name=body.name,
        dataset_version_id=version.id,
        org_id=org.id,
        org_slug=org.slug,
        mode=body.mode,
        status="running",
        config=config,
        config_hash=config_hash(config),
        snapshot=snapshot,
        total_cases=len(cases),
        max_judge_cost_usd=body.max_judge_cost_usd,
        tags=body.tags,
        created_by=admin.id,
        started_at=datetime.now(UTC),
    )
    session.add(run)
    await session.flush()

    run_cases: list[RunCase] = []
    for case in cases:
        scope = resolve_scope(case.scope_doc_codes or [], by_code)
        skipped = bool(scope.missing)
        run_cases.append(
            RunCase(
                id=uuid.uuid4(),
                run_id=run_id,
                case_id=case.id,
                case_key=case.case_key,
                status="skipped" if skipped else "pending",
                correlation_id=correlation_id(run_id, case.case_key),
                error_stage="scope" if skipped else None,
                error=(
                    f"Unknown scope_doc_codes in {org.slug}: {', '.join(scope.missing)}"
                    if skipped
                    else None
                ),
            )
        )
    session.add_all(run_cases)
    run.skipped_cases = sum(1 for rc in run_cases if rc.status == "skipped")
    await session.flush()

    probe_ids = {case.id for case in cases if case.type == "authz_probe"}
    pending = [rc for rc in run_cases if rc.status == "pending"]
    generate = [rc.id for rc in pending if rc.case_id not in probe_ids]
    probes = [rc.id for rc in pending if rc.case_id in probe_ids]
    await queue.enqueue_many(session, "case_generate", run_id, generate, max_attempts=CASE_ATTEMPTS)
    await queue.enqueue_many(session, "authz_probe", run_id, probes, max_attempts=CASE_ATTEMPTS)
    await run_state.settle(session, run)  # every case skipped → straight to finalize
    return run


def document_ids_for(run: Run, case: Case) -> list[str]:
    """The case's scope as DocuMind document ids, from the run's snapshot."""
    by_code = (run.snapshot.get("documents") or {}).get("by_code") or {}
    return resolve_scope(case.scope_doc_codes or [], by_code).document_ids


# --- reads -----------------------------------------------------------------------------------


def _with_dataset() -> Select[Any]:
    return (
        select(Run, Dataset.id, Dataset.slug, Dataset.name, DatasetVersion.version)
        .join(DatasetVersion, DatasetVersion.id == Run.dataset_version_id)
        .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
    )


def _dataset_ref(row: Any) -> dict[str, Any]:
    return {"dataset_id": row[1], "slug": row[2], "name": row[3], "version": row[4]}


async def list_runs(
    session: AsyncSession,
    *,
    dataset_id: uuid.UUID | None = None,
    dataset_version_id: uuid.UUID | None = None,
    org_slug: str | None = None,
    status: str | None = None,
    tag: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[tuple[Run, dict[str, Any]]], int]:
    stmt = _with_dataset()
    if dataset_id:
        stmt = stmt.where(Dataset.id == dataset_id)
    if dataset_version_id:
        stmt = stmt.where(Run.dataset_version_id == dataset_version_id)
    if org_slug:
        stmt = stmt.where(Run.org_slug == org_slug)
    if status:
        stmt = stmt.where(Run.status == status)
    if tag:
        stmt = stmt.where(Run.tags.any(tag))
    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (
        await session.execute(stmt.order_by(Run.created_at.desc()).limit(limit).offset(offset))
    ).all()
    return [(row[0], _dataset_ref(row)) for row in rows], int(total or 0)


async def get_run_or_404(session: AsyncSession, run_id: uuid.UUID) -> tuple[Run, dict[str, Any]]:
    row = (await session.execute(_with_dataset().where(Run.id == run_id))).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "Run not found.")
    return row[0], _dataset_ref(row)


async def case_status_counts(session: AsyncSession, run_id: uuid.UUID) -> dict[str, int]:
    rows = await session.execute(
        select(RunCase.status, func.count())
        .where(RunCase.run_id == run_id)
        .group_by(RunCase.status)
    )
    return {status: count for status, count in rows.all()}


def default_metric_mode(run: Run) -> str:
    return "chat" if run.mode == "full" else (run.config.get("retrieval_modes") or ["hybrid"])[-1]


async def list_run_cases(
    session: AsyncSession,
    run: Run,
    *,
    status: str | None = None,
    case_type: str | None = None,
    passed: bool | None = None,
    metric: str | None = None,
    lt: float | None = None,
    mode: str | None = None,
) -> list[tuple[RunCase, Case]]:
    """Cases in dataset order. `metric` + `lt` keeps cases whose score is below `lt` (in `mode`,
    default chat / the last retrieval mode)."""
    stmt = (
        select(RunCase, Case)
        .join(Case, Case.id == RunCase.case_id)
        .where(RunCase.run_id == run.id)
        .order_by(Case.position, Case.case_key)
    )
    if status:
        stmt = stmt.where(RunCase.status == status)
    if case_type:
        stmt = stmt.where(Case.type == case_type)
    if passed is not None:
        stmt = stmt.where(RunCase.passed.is_(passed))
    if metric:
        score = select(MetricScore.run_case_id).where(
            MetricScore.metric == metric,
            MetricScore.mode == (mode or default_metric_mode(run)),
            MetricScore.status == "ok",
        )
        if lt is not None:
            score = score.where(MetricScore.value < lt)
        stmt = stmt.where(RunCase.id.in_(score))
    return [(row[0], row[1]) for row in (await session.execute(stmt)).all()]


async def metric_values(
    session: AsyncSession, run_case_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[str, dict[str, float | None]]]:
    """run_case_id → mode → metric → value (ok scores only; others are None)."""
    if not run_case_ids:
        return {}
    rows = await session.execute(
        select(
            MetricScore.run_case_id, MetricScore.mode, MetricScore.metric, MetricScore.value
        ).where(MetricScore.run_case_id.in_(list(run_case_ids)))
    )
    values: dict[uuid.UUID, dict[str, dict[str, float | None]]] = {}
    for run_case_id, mode, metric, value in rows.all():
        values.setdefault(run_case_id, {}).setdefault(mode, {})[metric] = value
    return values


async def delete_run(session: AsyncSession, run: Run, documind: DocuMindClient) -> int:
    """Delete a run that isn't active, and its DocuMind eval conversations (usage rows stay in
    DocuMind's metering). Returns how many conversations DocuMind deleted."""
    if run.status in run_state.ACTIVE - {"paused"}:
        raise ApiError(
            409, "run_active", f"The run is {run.status}; stop it (or let it finish) first."
        )
    deleted = 0
    if run.mode == "full":
        deleted = await documind.delete_run_conversations(str(run.id))
    await session.delete(run)
    await session.flush()
    return deleted
