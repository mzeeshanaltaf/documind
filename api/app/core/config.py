import re
from functools import cached_property, lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

# api/app/core/config.py → repo root is three levels above `app/`.
REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

ServiceTier = Literal["standard", "flex", "auto"]


def parse_schema(database_url: str, default: str = "documind") -> str:
    """Read the Prisma-style `schema` query param; it becomes the Postgres search_path."""
    values = parse_qs(urlsplit(database_url).query).get("schema")
    schema = values[0] if values and values[0] else default
    if not SCHEMA_NAME_RE.match(schema):
        raise ValueError(f"Invalid schema name in DATABASE_URL: {schema!r}")
    return schema


class Settings(BaseSettings):
    # Run from api/ (uvicorn, alembic, pytest) → ../.env.local is the repo-root file.
    model_config = SettingsConfigDict(env_file=("../.env.local", ".env.local"), extra="ignore")

    database_url: str
    documind_api_key: str
    openai_api_key: str

    openai_chat_model: str = "gpt-6-luna"
    openai_router_model: str = "gpt-6-luna"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dim: int = 1536
    openai_chat_service_tier: ServiceTier = "standard"
    openai_background_service_tier: ServiceTier = "flex"

    s3_endpoint: str
    s3_region: str = "us-east-1"
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    s3_force_path_style: bool = True

    pricing_file: Path = REPO_ROOT / "model-pricing.json"

    max_upload_mb: int = 50
    ingest_concurrency: int = 1

    @cached_property
    def db_schema(self) -> str:
        return parse_schema(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # required fields come from the env
