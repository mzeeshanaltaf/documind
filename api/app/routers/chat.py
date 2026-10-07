"""Chat API: POST /v1/orgs/{org_id}/chat, streamed as Server-Sent Events.

Events (data is JSON): meta → routing → sources → delta… → citations → usage → done, or
`error` at any point after meta.
"""

from fastapi import APIRouter
from sse_starlette import EventSourceResponse
from starlette.background import BackgroundTask

from app.core.security import ActorDep, OrgDep, SessionDep
from app.schemas.chat import ChatRequest
from app.services import chat as service

router = APIRouter(tags=["chat"])


@router.post(
    "/orgs/{org_id}/chat",
    response_class=EventSourceResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def chat(
    org: OrgDep, actor: ActorDep, session: SessionDep, body: ChatRequest
) -> EventSourceResponse:
    """Ask a question. Starts a conversation unless `conversation_id` is given; `document_ids`
    scopes the answer to those documents."""
    turn = await service.prepare_turn(session, org.org_id, actor, body)
    events = service.run_chat(turn)
    return EventSourceResponse(
        events,
        ping=15,
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        # Runs after the response ends, also on client disconnect: closing a generator left
        # suspended at a `yield` saves the partial answer as `stopped`.
        background=BackgroundTask(events.aclose),
    )
