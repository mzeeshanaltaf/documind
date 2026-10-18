from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.auth import user_table
from app.models.base import Base
from app.models.common import UpdatedAt


class UserQuota(Base):
    """A platform admin's override of one user's monthly limits; no row = the env defaults."""

    __tablename__ = "user_quotas"
    __table_args__ = (
        CheckConstraint("message_limit >= 0", name="message_limit"),
        CheckConstraint("token_limit >= 0", name="token_limit"),
    )

    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey(user_table.c.id, ondelete="CASCADE"), primary_key=True
    )
    message_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    token_limit: Mapped[int] = mapped_column(BigInteger, nullable=False)
    updated_at: Mapped[UpdatedAt]
    updated_by: Mapped[str | None] = mapped_column(Text)


class QuotaUsage(Base):
    """What a user has consumed in one calendar month (UTC). Counters, not a view over
    `messages`/`llm_usage`, so deleting a conversation can't hand quota back."""

    __tablename__ = "quota_usage"

    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey(user_table.c.id, ondelete="CASCADE"), primary_key=True
    )
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    messages: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
