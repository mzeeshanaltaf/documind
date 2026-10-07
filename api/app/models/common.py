import uuid
from datetime import datetime
from typing import Annotated

from sqlalchemy import DateTime, Uuid, func, text
from sqlalchemy.orm import mapped_column

# uuid PKs: generated in Python (so ids are known before flush) with a DB default for raw SQL.
UuidPk = Annotated[
    uuid.UUID,
    mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    ),
]
CreatedAt = Annotated[
    datetime, mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
]
UpdatedAt = Annotated[
    datetime,
    mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    ),
]
OptionalTimestamp = Annotated[datetime | None, mapped_column(DateTime(timezone=True))]

EMPTY_ARRAY = text("'{}'")


def in_values(column: str, values: tuple[str, ...]) -> str:
    """SQL for a CHECK constraint restricting a text column to known values."""
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"
