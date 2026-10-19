"""Evaluation-harness tagging: `X-Eval-Run-Id` / `X-Eval-Case-Id` (platform admins only).

A tagged request is invisible to users: its conversation is `is_eval` (hidden from lists,
bookmarks and analytics, no title), its `llm_usage` rows carry the tags (excluded from analytics,
never added to a quota), and it may send per-request `overrides`. The browser can't set these
headers: the Next.js BFF forwards only `content-type` and `accept`.
"""

import re
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header

from app.core.errors import ApiError
from app.core.security import ActorDep

EVAL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


@dataclass(frozen=True)
class EvalContext:
    run_id: str
    case_id: str | None


def check_eval_id(value: str, name: str) -> str:
    if not EVAL_ID_RE.match(value):
        raise ApiError(
            422,
            "invalid_eval_header",
            f"{name} must be 1-100 characters of A-Z, a-z, 0-9, '_' or '-'.",
        )
    return value


async def get_eval_context(
    actor: ActorDep,
    x_eval_run_id: Annotated[
        str | None, Header(alias="X-Eval-Run-Id", description="Eval run id (admins only).")
    ] = None,
    x_eval_case_id: Annotated[
        str | None, Header(alias="X-Eval-Case-Id", description="Eval case id (admins only).")
    ] = None,
) -> EvalContext | None:
    if x_eval_run_id is None and x_eval_case_id is None:
        return None
    if x_eval_run_id is None:
        raise ApiError(422, "invalid_eval_header", "X-Eval-Case-Id needs X-Eval-Run-Id.")
    check_eval_id(x_eval_run_id, "X-Eval-Run-Id")
    if x_eval_case_id is not None:
        check_eval_id(x_eval_case_id, "X-Eval-Case-Id")
    if not actor.is_admin:
        raise ApiError(403, "eval_forbidden", "Eval headers are for platform admins only.")
    return EvalContext(run_id=x_eval_run_id, case_id=x_eval_case_id)


EvalDep = Annotated[EvalContext | None, Depends(get_eval_context)]
