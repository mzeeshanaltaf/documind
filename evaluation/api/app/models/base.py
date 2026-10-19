import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import get_settings

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Every eval table lives in the configured schema (documind_eval / _dev / _test). DocuMind's
# auth tables are read with raw, schema-qualified SQL and are never part of this metadata.
metadata = MetaData(schema=get_settings().db_schema, naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    metadata = metadata
    # Fetch server defaults / onupdate values with RETURNING after INSERT and UPDATE: in async
    # an expired attribute can't be lazy-loaded, so responses could not read `updated_at`.
    __mapper_args__ = {"eager_defaults": True}


class UuidPk:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class CreatedAt:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UpdatedAt:
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


def in_values(column: str, values: tuple[str, ...]) -> str:
    """SQL for a CHECK that keeps a text column inside an enum."""
    return f"{column} IN ({', '.join(repr(v) for v in values)})"
