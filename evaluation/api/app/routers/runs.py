"""Runs: create, list, read (with case drill-down and aggregates), control (pause, resume, stop),
follow (SSE progress) and export (CSV/JSON)."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, tuple_
from sse_starlette import EventSourceResponse

from app.core.db import SessionLocal
from app.core.errors import ApiError
from app.core.security import AdminDep, SessionDep
from app.documind.client import get_documind
from app.metrics.registry import describe
from app.models import Case, MetricScore, RetrievedContext, Run, RunAggregate, RunCase
from app.models.enums import RunCaseStatus, RunStatus
from app.schemas.datasets import CaseOut
from app.schemas.runs import (
    AggregateOut,
    ContextOut,
    DatasetVersionRef,
    MetricScoreOut,
    RunCaseDetailOut,
    RunCaseListOut,
    RunCaseOut,
    RunDetailOut,
    RunIn,
    RunListOut,
    RunOut,
)
from app.services import exports, run_state
from app.services import runs as service

router = APIRouter(tags=["runs"])

EVENTS_POLL_S = 1.0
EVENTS_BATCH = 50


def _run_out(run: Run, dataset: dict[str, Any] | None) -> RunOut:
    out = RunOut.model_validate(run)
    out.dataset = DatasetVersionRef(**dataset) if dataset else None
    return out


def _case_out(
    run_case: RunCase, case: Case, metrics: dict[str, dict[str, float | None]] | None = None
) -> RunCaseOut:
    out = RunCaseOut.model_validate(run_case)
    out.type, out.question, out.metrics = case.type, case.question, metrics or {}
    return out


@router.get("/metrics")
async def list_metrics(_: AdminDep) -> list[dict[str, Any]]:
    """Every metric the harness can compute: group, scale, direction, default threshold, gate."""
    return describe()


@router.post("/runs", status_code=status.HTTP_201_CREATED)
async def create_run(admin: AdminDep, session: SessionDep, body: RunIn) -> RunDetailOut:
    """Snapshot the config, create one run case per dataset case and enqueue them. The run
    starts at once (worker slots pick the jobs up)."""
    run = await service.create_run(session, body, admin, get_documind())
    await session.commit()
    return await _detail(session, run.id)


@router.get("/runs")
async def list_runs(
    _: AdminDep,
    session: SessionDep,
    dataset_id: uuid.UUID | None = None,
    dataset_version_id: uuid.UUID | None = None,
    org_slug: str | None = None,
    run_status: Annotated[RunStatus | None, Query(alias="status")] = None,
    tag: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RunListOut:
    rows, total = await service.list_runs(
        session,
        dataset_id=dataset_id,
        dataset_version_id=dataset_version_id,
        org_slug=org_slug,
        status=run_status,
        tag=tag,
        limit=limit,
        offset=offset,
    )
    return RunListOut(runs=[_run_out(run, ref) for run, ref in rows], total=total)


async def _detail(session: SessionDep, run_id: uuid.UUID) -> RunDetailOut:
    run, ref = await service.get_run_or_404(session, run_id)
    aggregates = (
        await session.execute(
            select(RunAggregate)
            .where(RunAggregate.run_id == run_id, RunAggregate.slice == "all")
            .order_by(RunAggregate.mode, RunAggregate.metric)
        )
    ).scalars()
    return RunDetailOut(
        **_run_out(run, ref).model_dump(),
        snapshot=run.snapshot,
        case_status_counts=await service.case_status_counts(session, run_id),
        aggregates=[AggregateOut.model_validate(a) for a in aggregates],
    )


@router.get("/runs/{run_id}")
async def get_run(_: AdminDep, session: SessionDep, run_id: uuid.UUID) -> RunDetailOut:
    return await _detail(session, run_id)


@router.delete("/runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_run(_: AdminDep, session: SessionDep, run_id: uuid.UUID) -> Response:
    """Delete a finished or paused run, and its eval conversations in DocuMind."""
    run, _ref = await service.get_run_or_404(session, run_id)
    await service.delete_run(session, run, get_documind())
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/runs/{run_id}/aggregates")
async def get_aggregates(
    _: AdminDep,
    session: SessionDep,
    run_id: uuid.UUID,
    slice_: Annotated[str | None, Query(alias="slice")] = None,
    mode: str | None = None,
    metric: str | None = None,
) -> list[AggregateOut]:
    await service.get_run_or_404(session, run_id)
    stmt = select(RunAggregate).where(RunAggregate.run_id == run_id)
    if slice_:
        stmt = stmt.where(RunAggregate.slice == slice_)
    if mode:
        stmt = stmt.where(RunAggregate.mode == mode)
    if metric:
        stmt = stmt.where(RunAggregate.metric == metric)
    stmt = stmt.order_by(RunAggregate.mode, RunAggregate.metric, RunAggregate.slice)
    return [AggregateOut.model_validate(a) for a in (await session.execute(stmt)).scalars()]


# --- cases -----------------------------------------------------------------------------------


@router.get("/runs/{run_id}/cases")
async def list_run_cases(
    _: AdminDep,
    session: SessionDep,
    run_id: uuid.UUID,
    case_status: Annotated[RunCaseStatus | None, Query(alias="status")] = None,
    case_type: Annotated[str | None, Query(alias="type")] = None,
    passed: bool | None = None,
    metric: str | None = None,
    lt: float | None = None,
    mode: str | None = None,
) -> RunCaseListOut:
    """Filters: status, type, passed, and `metric` (+ `lt`, `mode`) for "cases where mrr < 0.5"."""
    run, _ref = await service.get_run_or_404(session, run_id)
    rows = await service.list_run_cases(
        session,
        run,
        status=case_status,
        case_type=case_type,
        passed=passed,
        metric=metric,
        lt=lt,
        mode=mode,
    )
    values = await service.metric_values(session, [rc.id for rc, _ in rows])
    return RunCaseListOut(
        cases=[_case_out(rc, case, values.get(rc.id)) for rc, case in rows], total=len(rows)
    )


@router.get("/runs/{run_id}/cases/{run_case_id}")
async def get_run_case(
    _: AdminDep, session: SessionDep, run_id: uuid.UUID, run_case_id: uuid.UUID
) -> RunCaseDetailOut:
    run_case = await session.get(RunCase, run_case_id)
    if run_case is None or run_case.run_id != run_id:
        raise ApiError(404, "not_found", "Run case not found.")
    case = await session.get(Case, run_case.case_id)
    assert case is not None  # FK RESTRICT
    scores = list(
        (
            await session.execute(
                select(MetricScore)
                .where(MetricScore.run_case_id == run_case_id)
                .order_by(MetricScore.mode, MetricScore.metric)
            )
        ).scalars()
    )
    contexts = (
        await session.execute(
            select(RetrievedContext)
            .where(RetrievedContext.run_case_id == run_case_id)
            .order_by(RetrievedContext.mode, RetrievedContext.rank)
        )
    ).scalars()
    values: dict[str, dict[str, float | None]] = {}
    for score in scores:
        values.setdefault(score.mode, {})[score.metric] = score.value
    summary = _case_out(run_case, case, values)
    return RunCaseDetailOut(
        **summary.model_dump(),
        correlation_id=run_case.correlation_id,
        conversation_id=run_case.conversation_id,
        answer=run_case.answer,
        routing=run_case.routing,
        citations=run_case.citations,
        trace=run_case.trace,
        input_tokens=run_case.input_tokens,
        cached_tokens=run_case.cached_tokens,
        output_tokens=run_case.output_tokens,
        documind_usage=run_case.documind_usage,
        judge_cost_usd=float(run_case.judge_cost_usd),
        case=CaseOut.model_validate(case),
        scores=[MetricScoreOut.model_validate(s) for s in scores],
        contexts=[ContextOut.model_validate(c) for c in contexts],
    )


# --- controls --------------------------------------------------------------------------------


@router.post("/runs/{run_id}/pause")
async def pause_run(_: AdminDep, session: SessionDep, run_id: uuid.UUID) -> RunOut:
    """`pausing` until no case is in flight, then `paused`. 409 unless running."""
    run = await run_state.pause(session, run_id)
    await session.commit()
    return RunOut.model_validate(run)


@router.post("/runs/{run_id}/resume")
async def resume_run(_: AdminDep, session: SessionDep, run_id: uuid.UUID) -> RunOut:
    run = await run_state.resume(session, run_id)
    await session.commit()
    return RunOut.model_validate(run)


@router.post("/runs/{run_id}/stop")
async def stop_run(_: AdminDep, session: SessionDep, run_id: uuid.UUID) -> RunOut:
    """Queued cases are cancelled, in-flight ones finish, then the run finalizes as partial."""
    run = await run_state.stop(session, run_id)
    await session.commit()
    return RunOut.model_validate(run)


# --- progress (SSE) --------------------------------------------------------------------------


def encode_cursor(updated_at: datetime, run_case_id: uuid.UUID) -> str:
    return f"{updated_at.isoformat()}|{run_case_id}"


def decode_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if not cursor:
        return None
    try:
        stamp, _, run_case_id = cursor.partition("|")
        return datetime.fromisoformat(stamp), uuid.UUID(run_case_id)
    except ValueError as exc:
        raise ApiError(422, "invalid_cursor", "Malformed Last-Event-ID / cursor.") from exc


def run_event(run: Run) -> dict[str, Any]:
    return {
        "id": str(run.id),
        "status": run.status,
        "status_reason": run.status_reason,
        "total_cases": run.total_cases,
        "done_cases": run.done_cases,
        "failed_cases": run.failed_cases,
        "skipped_cases": run.skipped_cases,
        "passed_cases": run.passed_cases,
        "documind_cost_usd": float(run.documind_cost_usd),
        "judge_cost_usd": float(run.judge_cost_usd),
        "partial": run.partial,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "error": run.error,
    }


async def progress_events(
    run_id: uuid.UUID, cursor: tuple[datetime, uuid.UUID] | None
) -> AsyncIterator[dict[str, str]]:
    """Poll once a second: a `run` event whenever its status/counters change, and `case` events
    for run cases updated after the cursor (≤ 50 per tick; the id is the next cursor). Ends on
    a terminal status once every update has been sent."""
    last_run: dict[str, Any] | None = None
    while True:
        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            if run is None:
                yield {"event": "error", "data": json.dumps({"message": "Run not found."})}
                return
            stmt = (
                select(RunCase, Case)
                .join(Case, Case.id == RunCase.case_id)
                .where(RunCase.run_id == run_id)
                .order_by(RunCase.updated_at, RunCase.id)
                .limit(EVENTS_BATCH)
            )
            if cursor is not None:
                stmt = stmt.where(tuple_(RunCase.updated_at, RunCase.id) > tuple_(*cursor))
            rows = [(row[0], row[1]) for row in (await session.execute(stmt)).all()]
            values = await service.metric_values(session, [rc.id for rc, _ in rows])
        payload = run_event(run)
        if payload != last_run:
            last_run = payload
            yield {"event": "run", "data": json.dumps(payload)}
        for run_case, case in rows:
            cursor = (run_case.updated_at, run_case.id)
            yield {
                "event": "case",
                "id": encode_cursor(*cursor),
                "data": _case_out(run_case, case, values.get(run_case.id)).model_dump_json(),
            }
        if len(rows) < EVENTS_BATCH:
            if run.status in run_state.TERMINAL:
                return
            await asyncio.sleep(EVENTS_POLL_S)


@router.get("/runs/{run_id}/events", response_class=EventSourceResponse)
async def run_events(
    _: AdminDep,
    session: SessionDep,
    run_id: uuid.UUID,
    cursor: str | None = None,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> EventSourceResponse:
    """Live progress: `run` events (status, counters, cost) and `case` events. Reconnect with
    `Last-Event-ID` (or `?cursor=`) to resume after the last case seen."""
    await service.get_run_or_404(session, run_id)
    start = decode_cursor(last_event_id or cursor)
    await session.close()  # don't hold a pooled connection for the stream's lifetime
    return EventSourceResponse(progress_events(run_id, start), ping=15)


# --- export ----------------------------------------------------------------------------------


@router.get("/runs/{run_id}/export")
async def export_run(
    _: AdminDep,
    session: SessionDep,
    run_id: uuid.UUID,
    export_format: Annotated[Literal["csv", "json"], Query(alias="format")] = "csv",
) -> Response:
    run, _ref = await service.get_run_or_404(session, run_id)
    filename = f"run-{run.id.hex[:8]}.{export_format}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    if export_format == "csv":
        body = await exports.export_csv(session, run)
        return Response(body, media_type="text/csv; charset=utf-8", headers=headers)
    return JSONResponse(await exports.export_json(session, run), headers=headers)
