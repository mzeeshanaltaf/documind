"""A/B comparison of two runs, paired on case keys (E6)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.security import AdminDep, SessionDep
from app.schemas.compare import CompareOut
from app.schemas.runs import DatasetVersionRef, RunOut
from app.services import compare as service

router = APIRouter(tags=["compare"])


def split_keys(values: list[str] | None) -> list[str] | None:
    if not values:
        return None
    keys = [key.strip() for value in values for key in value.split(",") if key.strip()]
    return keys or None


@router.get("/compare")
async def compare(
    _: AdminDep,
    session: SessionDep,
    a: uuid.UUID,
    b: uuid.UUID,
    metrics: Annotated[
        list[str] | None, Query(description="Repeat or comma-separate. Default: every metric.")
    ] = None,
    mode: Annotated[
        str | None, Query(description="chat, bm25, vector or hybrid (default: chat, else hybrid).")
    ] = None,
) -> CompareOut:
    """Runs A and B paired on `case_key`: a config diff, one paired test per metric (bootstrap
    CI + sign-flip permutation, or exact McNemar for binary metrics; Holm-adjusted across the
    metrics shown), per-case deltas and classes, and the A/A noise floor. Δ = B − A."""
    result = await service.compare(session, a, b, metrics=split_keys(metrics), mode=mode)
    runs = {}
    for side in ("a", "b"):
        run, ref = result.pop(side)
        out = RunOut.model_validate(run)
        out.dataset = DatasetVersionRef(**ref)
        runs[side] = out
    return CompareOut.model_validate({**result, **runs})
