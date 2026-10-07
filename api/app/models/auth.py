"""Read-only mirrors of Better Auth tables, used for joins, FKs and authorization.

Better Auth (web/) owns these tables and their migrations; Alembic excludes them
(`BETTER_AUTH_TABLES`). Columns are camelCase in SQL; `key=` gives them snake_case
attribute names in Python. Only the columns the API reads are declared.
"""

from sqlalchemy import Boolean, Column, DateTime, Table, Text

from app.models.base import metadata

BETTER_AUTH_TABLES = frozenset(
    {"user", "session", "account", "verification", "organization", "member", "invitation"}
)

user_table = Table(
    "user",
    metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("email", Text, nullable=False),
    Column("emailVerified", Boolean, key="email_verified", nullable=False),
    Column("role", Text),
    Column("banned", Boolean),
    Column("banExpires", DateTime(timezone=True), key="ban_expires"),
)

organization_table = Table(
    "organization",
    metadata,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("slug", Text, nullable=False),
)

member_table = Table(
    "member",
    metadata,
    Column("id", Text, primary_key=True),
    Column("organizationId", Text, key="organization_id", nullable=False),
    Column("userId", Text, key="user_id", nullable=False),
    Column("role", Text, nullable=False),
)
