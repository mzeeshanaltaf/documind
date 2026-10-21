"""Judge calibration (E9): agreement rows, the current badges, a run's badges, recompute."""

import uuid

from fastapi import APIRouter

from app.core.security import AdminDep, SessionDep
from app.schemas.review import Badge, CalibrationListOut, CalibrationOut, RunCalibrationOut
from app.services import calibration as service
from app.services import runs as runs_service

router = APIRouter(tags=["calibration"])

THRESHOLDS = {
    "min_n": service.MIN_N,
    "calibrated_n": service.CALIBRATED_N,
    "unreliable_below": service.UNRELIABLE_BELOW,
    "calibrated_from": service.CALIBRATED_FROM,
}


async def _list(session: SessionDep) -> CalibrationListOut:
    current = await service.current_badges(session)
    now = {(b["metric"], b["prompt_version"], b["judge_model"]) for b in current}
    rows = [
        CalibrationOut.model_validate(
            {
                **{c: getattr(cal, c) for c in CalibrationOut.model_fields if hasattr(cal, c)},
                "prompt_key": key,
                "prompt_version": version,
                "current": (cal.metric, version, cal.judge_model) in now,
            }
        )
        for cal, key, version in await service.list_rows(session)
    ]
    return CalibrationListOut(
        rows=rows, current=[Badge(**b) for b in current], thresholds=THRESHOLDS
    )


@router.get("/calibration")
async def list_calibration(_: AdminDep, session: SessionDep) -> CalibrationListOut:
    return await _list(session)


@router.post("/calibration/recompute")
async def recompute(_: AdminDep, session: SessionDep) -> CalibrationListOut:
    """Rebuild every row now (the review submits schedule the same job, debounced)."""
    await service.compute(session)
    await session.commit()
    return await _list(session)


@router.get("/runs/{run_id}/calibration")
async def run_calibration(_: AdminDep, session: SessionDep, run_id: uuid.UUID) -> RunCalibrationOut:
    run, _ref = await runs_service.get_run_or_404(session, run_id)
    badges = await service.run_badges(session, run)
    return RunCalibrationOut(run_id=run.id, badges=[Badge(**b) for b in badges])
