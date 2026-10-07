"""Conversations (owner-only) and answer feedback."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.security import ActorDep, OrgDep, SessionDep
from app.schemas.chat import (
    ConversationDetailOut,
    ConversationListOut,
    ConversationOut,
    ConversationPatch,
    FeedbackIn,
    FeedbackOut,
    MessageOut,
    MessageUsageOut,
)
from app.services import conversations as service

router = APIRouter(tags=["conversations"])


@router.get("/orgs/{org_id}/conversations")
async def list_conversations(
    org: OrgDep,
    actor: ActorDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> ConversationListOut:
    """The actor's own conversations in this org, newest activity first."""
    rows, next_cursor = await service.list_conversations(
        session, org.org_id, actor, limit=limit, cursor=cursor
    )
    return ConversationListOut(
        conversations=[ConversationOut.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    actor: ActorDep, session: SessionDep, conversation_id: uuid.UUID
) -> ConversationDetailOut:
    conversation = await service.get_owned_conversation(session, actor, conversation_id)
    messages = await service.list_messages(session, conversation.id)
    return ConversationDetailOut(
        **ConversationOut.model_validate(conversation).model_dump(),
        messages=[
            MessageOut.model_validate(message).model_copy(
                update={
                    "usage": MessageUsageOut.from_retrieval(message.retrieval)
                    if actor.is_admin and message.role == "assistant"
                    else None
                }
            )
            for message in messages
        ],
    )


@router.patch("/conversations/{conversation_id}")
async def rename_conversation(
    actor: ActorDep, session: SessionDep, conversation_id: uuid.UUID, body: ConversationPatch
) -> ConversationOut:
    conversation = await service.get_owned_conversation(session, actor, conversation_id)
    return ConversationOut.model_validate(await service.rename(session, conversation, body.title))


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    actor: ActorDep, session: SessionDep, conversation_id: uuid.UUID
) -> Response:
    conversation = await service.get_owned_conversation(session, actor, conversation_id)
    await service.delete(session, conversation)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/messages/{message_id}/feedback")
async def submit_feedback(
    actor: ActorDep, session: SessionDep, message_id: uuid.UUID, body: FeedbackIn
) -> FeedbackOut:
    """👍 (1) or 👎 (-1) on an answer, by the conversation's owner; resubmitting replaces it."""
    message = await service.set_feedback(session, actor, message_id, body.value, body.comment)
    return FeedbackOut(
        message_id=message.id,
        feedback=message.feedback or body.value,
        feedback_comment=message.feedback_comment,
    )
