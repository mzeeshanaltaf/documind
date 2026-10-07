import pytest

from app.core.db import APPLICATION_NAME, normalize_database_url

# Same shape as the real DATABASE_URL (Prisma-style params), with dummy credentials.
PROD_LIKE = (
    "postgres://app:s3cr%40t@db.example.com:5432/postgresdb"
    "?schema=documind&sslmode=require&uselibpqcompat=true&connection_limit=1&pool_timeout=20"
)


def test_prisma_style_url_is_normalized() -> None:
    db = normalize_database_url(PROD_LIKE)

    assert db.url == "postgresql+asyncpg://app:s3cr%40t@db.example.com:5432/postgresdb"
    assert db.schema == "documind"
    assert db.connect_args == {
        "ssl": "require",
        "server_settings": {"search_path": "documind,public", "application_name": APPLICATION_NAME},
    }


def test_every_query_param_is_dropped() -> None:
    db = normalize_database_url(PROD_LIKE)

    for param in ("schema", "sslmode", "uselibpqcompat", "connection_limit", "pool_timeout"):
        assert param not in db.url
    assert "?" not in db.url


def test_dev_schema_sets_search_path() -> None:
    db = normalize_database_url("postgresql://u:p@localhost/db?schema=documind_dev")

    assert db.schema == "documind_dev"
    assert db.connect_args["server_settings"]["search_path"] == "documind_dev,public"
    assert "ssl" not in db.connect_args


def test_schema_defaults_to_documind() -> None:
    db = normalize_database_url("postgres://u:p@localhost:5432/db")

    assert db.schema == "documind"
    assert db.url == "postgresql+asyncpg://u:p@localhost:5432/db"


def test_other_sslmodes_pass_through() -> None:
    db = normalize_database_url("postgres://u:p@h/db?sslmode=disable")

    assert db.connect_args["ssl"] == "disable"


@pytest.mark.parametrize("schema", ["Documind", "doc-mind", "x;drop schema public", "1abc"])
def test_invalid_schema_is_rejected(schema: str) -> None:
    with pytest.raises(ValueError, match="Invalid schema"):
        normalize_database_url(f"postgres://u:p@h/db?schema={schema}")


def test_unsupported_scheme_is_rejected() -> None:
    with pytest.raises(ValueError, match="Unsupported"):
        normalize_database_url("mysql://u:p@h/db")
