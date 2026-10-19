import uuid
from typing import Any

from sqlalchemy import Boolean, Index, Integer, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.common import CreatedAt, UuidPk


class ApiRequestLog(Base):
    """One row per `/v1` request (core/request_log.py). No FKs on purpose, like `llm_usage`:
    logs outlive deleted users and orgs. Pruned after `request_log_retention_days`."""

    __tablename__ = "api_request_logs"
    __table_args__ = (
        Index(None, "status_code", "created_at"),
        Index(None, "route", "created_at"),
        Index(None, "user_id", "created_at"),
        Index(None, "request_id"),
    )

    id: Mapped[UuidPk]
    created_at: Mapped[CreatedAt]
    request_id: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    query: Mapped[str | None] = mapped_column(Text)
    route: Mapped[str | None] = mapped_column(Text)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[str | None] = mapped_column(Text)
    org_id: Mapped[str | None] = mapped_column(Text)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    message_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    document_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    client_ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    request_headers: Mapped[Any | None] = mapped_column(JSONB)
    request_body: Mapped[Any | None] = mapped_column(JSONB)
    request_body_size: Mapped[int | None] = mapped_column(Integer)
    response_headers: Mapped[Any | None] = mapped_column(JSONB)
    response_body: Mapped[Any | None] = mapped_column(JSONB)
    response_content_type: Mapped[str | None] = mapped_column(Text)
    response_body_size: Mapped[int | None] = mapped_column(Integer)
    body_truncated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    error_traceback: Mapped[str | None] = mapped_column(Text)


# Declared after the class so the DESC column expression can reference the mapped column.
Index("ix_api_request_logs_created_at", ApiRequestLog.created_at.desc())
