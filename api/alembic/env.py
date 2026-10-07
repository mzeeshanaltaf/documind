import asyncio
from logging.config import fileConfig

from alembic import context
from pgvector.sqlalchemy import Vector
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.core.db import normalize_database_url
from app.models import BETTER_AUTH_TABLES, metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = metadata
db = normalize_database_url(get_settings().database_url)
SCHEMA = db.schema


def include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    # The Postgres server is shared with other apps: only ever look at our own schema.
    # (`None` is the default schema, `public` here — it holds other apps' tables.)
    if type_ == "schema":
        return name == SCHEMA
    return True


def include_object(obj, name, type_, reflected, compare_to) -> bool:  # noqa: ANN001
    # Better Auth owns its tables; never create, alter or drop them (or their indexes/FKs).
    table = obj if type_ == "table" else getattr(obj, "table", None)
    return table is None or table.name not in BETTER_AUTH_TABLES


def configure_kwargs() -> dict:
    return {
        "target_metadata": target_metadata,
        "version_table_schema": SCHEMA,
        "include_schemas": True,
        "include_name": include_name,
        "include_object": include_object,
        "compare_type": True,
    }


def run_migrations_offline() -> None:
    """`alembic upgrade head --sql`: emit SQL without connecting."""
    context.configure(
        url=db.url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **configure_kwargs(),
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    # Let autogenerate reflect pgvector columns as Vector rather than NullType.
    connection.dialect.ischema_names["vector"] = Vector
    context.configure(connection=connection, **configure_kwargs())
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # Unlike the app, migrations run with search_path=public, so our schema is never the
    # *default* one: reflection then reports it by name, matching the schema-qualified
    # metadata, and autogenerate compares FKs/tables like for like.
    connect_args = {
        **db.connect_args,
        "server_settings": {**db.connect_args["server_settings"], "search_path": "public"},
    }
    connectable = create_async_engine(db.url, connect_args=connect_args, poolclass=pool.NullPool)

    # alembic_version lives in our schema, so the schema must exist before Alembic touches it.
    async with connectable.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
