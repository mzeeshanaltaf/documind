from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings, parse_schema

APPLICATION_NAME = "documind-api"


@dataclass(frozen=True)
class NormalizedDatabaseUrl:
    url: str
    schema: str
    connect_args: dict[str, Any] = field(default_factory=dict)


def normalize_database_url(raw: str) -> NormalizedDatabaseUrl:
    """Turn the Prisma-style DATABASE_URL into an asyncpg URL plus connect args.

    Every query param is dropped (asyncpg rejects `schema`, `connection_limit`, `pool_timeout`,
    `uselibpqcompat`). `schema` becomes the search_path (`public` stays on it because the
    `vector` type lives there) and `sslmode` becomes asyncpg's `ssl` argument.
    """
    parts = urlsplit(raw)
    if parts.scheme not in {"postgres", "postgresql", "postgresql+asyncpg"}:
        raise ValueError(f"Unsupported DATABASE_URL scheme: {parts.scheme!r}")

    schema = parse_schema(raw)
    params = parse_qs(parts.query)
    url = urlunsplit(("postgresql+asyncpg", parts.netloc, parts.path, "", ""))

    connect_args: dict[str, Any] = {
        "server_settings": {"search_path": f"{schema},public", "application_name": APPLICATION_NAME}
    }
    sslmode = params.get("sslmode", [""])[0]
    if sslmode:
        # asyncpg accepts libpq's sslmode names (disable/allow/prefer/require/verify-*) as `ssl`.
        connect_args["ssl"] = sslmode
    return NormalizedDatabaseUrl(url=url, schema=schema, connect_args=connect_args)


_db = normalize_database_url(get_settings().database_url)

# The Postgres server is shared by many apps, so keep the pool small.
engine = create_async_engine(
    _db.url,
    connect_args=_db.connect_args,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Session outside requests (worker, scripts): commits on success, rolls back on error."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
