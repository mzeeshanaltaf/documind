"""Test setup. The app is pointed at schema `documind_eval_test` *before* any app module builds
its engine; `db`-marked tests get it migrated once per session (and dropped at the end).

DocuMind's auth schema (`EVAL_AUTH_SCHEMA`, documind_dev locally) is only read: admin checks use
the real `eval-bot` / `eval-probe` users from `scripts/bootstrap_service_users.py`.
"""

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from app.core.config import Settings, get_settings, with_schema

TEST_SCHEMA = "documind_eval_test"
API_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"

os.environ["EVAL_DATABASE_URL"] = with_schema(
    Settings().eval_database_url,  # type: ignore[call-arg]
    TEST_SCHEMA,
)
os.environ["EVAL_WORKER_SLOTS"] = "0"
get_settings.cache_clear()
assert get_settings().db_schema == TEST_SCHEMA

import httpx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.db import engine  # noqa: E402


def _migrate() -> None:
    from alembic import command
    from alembic.config import Config

    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")


@pytest.fixture(scope="session")
async def eval_schema() -> AsyncIterator[str]:
    async with engine.begin() as conn:
        await conn.execute(text(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE'))
    # env.py calls asyncio.run(), which needs a thread without a running loop.
    await asyncio.to_thread(_migrate)
    yield TEST_SCHEMA
    async with engine.begin() as conn:
        await conn.execute(text(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE'))
    await engine.dispose()


@pytest.fixture(autouse=True)
def _db_marker(request: pytest.FixtureRequest) -> None:
    if request.node.get_closest_marker("db"):
        request.getfixturevalue("eval_schema")


@pytest.fixture
def admin_id() -> str:
    user_id = get_settings().eval_service_user_id
    if not user_id:
        pytest.skip("EVAL_SERVICE_USER_ID is not set (run scripts.bootstrap_service_users)")
    return user_id


@pytest.fixture
def probe_id() -> str:
    user_id = get_settings().eval_probe_user_id
    if not user_id:
        pytest.skip("EVAL_PROBE_USER_ID is not set (run scripts.bootstrap_service_users)")
    return user_id


@pytest.fixture
async def api(admin_id: str) -> AsyncIterator[httpx.AsyncClient]:
    """The eval API in-process, as the eval-bot admin (no lifespan: no worker slots)."""
    from app.main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://eval.test",
        headers={"X-API-Key": get_settings().eval_api_key, "X-User-Id": admin_id},
    ) as client:
        yield client
