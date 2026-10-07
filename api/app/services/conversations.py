"""Conversations and feedback. Owner-only: nobody (admins included) reads another user's chats,
and the owner must still have access to the conversation's org."""

import base64
import uuid
from datetime import datetime

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.security import Actor
from app.models.auth import member_table
from app.models.chat import Conversation, Message


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Conversation not found.")


def encode_cursor(updated_at: datetime, conversation_id: uuid.UUID) -> str:
    raw = f"{updated_at.isoformat()}|{conversation_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        stamp, conversation_id = base64.urlsafe_b64decode(padded).decode().split("|")
        return datetime.fromisoformat(stamp), uuid.UUID(conversation_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "invalid_cursor", "Invalid cursor.") from None


async def list_conversations(
    session: AsyncSession, org_id: str, actor: Actor, *, limit: int, cursor: str | None
) -> tuple[list[Conversation], str | None]:
    """The actor's conversations in the org, most recently active first (keyset paginated)."""
    query = (
        select(Conversation)
        .where(Conversation.org_id == org_id, Conversation.user_id == actor.id)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        stamp, last_id = decode_cursor(cursor)
        query = query.where(
            tuple_(Conversation.updated_at, Conversation.id) < tuple_(stamp, last_id)
        )
    rows = list((await session.execute(query)).scalars().all())
    if len(rows) <= limit:
        return rows, None
    rows = rows[:limit]
    return rows, encode_cursor(rows[-1].updated_at, rows[-1].id)


async def _has_org_access(session: AsyncSession, actor: Actor, org_id: str) -> bool:
    if actor.is_admin:
        return True
    role = (
        await session.execute(
            select(member_table.c.role).where(
                member_table.c.organization_id == org_id, member_table.c.user_id == actor.id
            )
        )
    ).scalar_one_or_none()
    return role is not None


async def get_owned_conversation(
    session: AsyncSession, actor: Actor, conversation_id: uuid.UUID
) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    if (
        conversation is None
        or conversation.user_id != actor.id
        or not await _has_org_access(session, actor, conversation.org_id)
    ):
        raise _not_found()
    return conversation


async def list_messages(session: AsyncSession, conversation_id: uuid.UUID) -> list[Message]:
    return list(
        (
            await session.execute(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at, Message.role.desc(), Message.id)
            )
        )
        .scalars()
        .all()
    )


async def rename(session: AsyncSession, conversation: Conversation, title: str) -> Conversation:
    conversation.title = title
    await session.commit()
    await session.refresh(conversation)
    return conversation


async def delete(session: AsyncSession, conversation: Conversation) -> None:
    await session.delete(conversation)  # messages cascade
    await session.commit()


async def set_feedback(
    session: AsyncSession, actor: Actor, message_id: uuid.UUID, value: int, comment: str | None
) -> Message:
    message = await session.get(Message, message_id)
    if message is None:
        raise ApiError(404, "not_found", "Message not found.")
    try:
        await get_owned_conversation(session, actor, message.conversation_id)
    except ApiError:
        raise ApiError(404, "not_found", "Message not found.") from None
    if message.role != "assistant":
        raise ApiError(422, "not_an_answer", "Feedback can only be given on answers.")
    message.feedback = value
    message.feedback_comment = (comment or "").strip() or None
    await session.commit()
    return message
