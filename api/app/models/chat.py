import uuid
from typing import Any

from sqlalchemy import ARRAY, CheckConstraint, ForeignKey, Index, SmallInteger, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import organization_table, user_table
from app.models.base import Base
from app.models.common import EMPTY_ARRAY, CreatedAt, UpdatedAt, UuidPk, in_values

CONVERSATION_SCOPES = ("all", "docs")
MESSAGE_ROLES = ("user", "assistant")
MESSAGE_STATUSES = ("complete", "error", "stopped")


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (CheckConstraint(in_values("scope", CONVERSATION_SCOPES), name="scope"),)

    id: Mapped[UuidPk]
    org_id: Mapped[str] = mapped_column(
        Text, ForeignKey(organization_table.c.id, ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey(user_table.c.id, ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(Text, nullable=False, default="all", server_default="all")
    document_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(Uuid), nullable=False, default=list, server_default=EMPTY_ARRAY
    )
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


# Declared after the class so the DESC column expression can reference the mapped column.
Index(
    "ix_conversations_org_id_user_id_updated_at",
    Conversation.org_id,
    Conversation.user_id,
    Conversation.updated_at.desc(),
)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index(None, "conversation_id", "created_at"),
        CheckConstraint(in_values("role", MESSAGE_ROLES), name="role"),
        CheckConstraint(in_values("status", MESSAGE_STATUSES), name="status"),
        CheckConstraint("feedback IS NULL OR feedback IN (-1, 1)", name="feedback"),
    )

    id: Mapped[UuidPk]
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey(Conversation.id, ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    citations: Mapped[Any | None] = mapped_column(JSONB)
    sources: Mapped[Any | None] = mapped_column(JSONB)
    routing: Mapped[Any | None] = mapped_column(JSONB)
    retrieval: Mapped[Any | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="complete", server_default="complete"
    )
    feedback: Mapped[int | None] = mapped_column(SmallInteger)
    feedback_comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[CreatedAt]
