import re
from functools import cached_property, lru_cache
from pathlib import Path
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# evaluation/api/app/core/config.py → the repo root is four levels above `app/`.
REPO_ROOT = Path(__file__).resolve().parents[4]
SCHEMA_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]*$")
DEFAULT_SCHEMA = "documind_eval"


def parse_schema(database_url: str, default: str = DEFAULT_SCHEMA) -> str:
    """Read the Prisma-style `schema` query param; it becomes the Postgres search_path.
    Ported from DocuMind's `api/app/core/config.py`."""
    values = parse_qs(urlsplit(database_url).query).get("schema")
    schema = values[0] if values and values[0] else default
    if not SCHEMA_NAME_RE.match(schema):
        raise ValueError(f"Invalid schema name in EVAL_DATABASE_URL: {schema!r}")
    return schema


def with_schema(database_url: str, schema: str) -> str:
    """The same URL pointed at another schema (tests use `documind_eval_test`)."""
    parts = urlsplit(database_url)
    params = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "schema"]
    return urlunsplit(parts._replace(query=urlencode([("schema", schema), *params], safe=",")))


class Settings(BaseSettings):
    # Run from evaluation/api/ (uvicorn, alembic, pytest) → ../../.env.local is the root file.
    model_config = SettingsConfigDict(env_file=("../../.env.local", ".env.local"), extra="ignore")

    eval_database_url: str
    # DocuMind's Better Auth schema: admins are checked against its "user" table.
    eval_auth_schema: str = "documind"
    eval_api_key: str

    documind_api_url: str = "http://localhost:8000"
    documind_api_key: str
    # Filled in from scripts/bootstrap_service_users.py.
    eval_service_user_id: str | None = None
    eval_probe_user_id: str | None = None

    anthropic_api_key: str | None = None

    eval_worker_slots: int = 4
    eval_documind_concurrency: int = 2
    eval_judge_concurrency: int = 4
    eval_anthropic_max_rpm: int = 50

    golden_file: Path = REPO_ROOT / "api" / "eval" / "golden.jsonl"

    # The deployed commit (Dockerfile: SOURCE_COMMIT build arg → GIT_SHA), shown by /health.
    git_sha: str = "dev"

    @field_validator("eval_auth_schema")
    @classmethod
    def _auth_schema(cls, value: str) -> str:
        # It is interpolated into SQL (`"<schema>"."user"`), so it must be a plain identifier.
        if not SCHEMA_NAME_RE.match(value):
            raise ValueError(f"Invalid EVAL_AUTH_SCHEMA: {value!r}")
        return value

    @cached_property
    def db_schema(self) -> str:
        return parse_schema(self.eval_database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # required fields come from the env
