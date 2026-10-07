from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.llm.pricing import chat_models, load_pricing
from app.models.org_settings import OrgSettings

DEFAULT_TOP_K = 8
OVERRIDABLE = ("chat_model", "router_model", "chat_service_tier", "background_service_tier")


@dataclass(frozen=True)
class EffectiveSettings:
    """Per-org settings with NULL columns resolved to the env defaults."""

    chat_model: str
    router_model: str
    chat_service_tier: str
    background_service_tier: str
    top_k: int


def default_settings() -> EffectiveSettings:
    env = get_settings()
    return EffectiveSettings(
        chat_model=env.openai_chat_model,
        router_model=env.openai_router_model,
        chat_service_tier=env.openai_chat_service_tier,
        background_service_tier=env.openai_background_service_tier,
        top_k=DEFAULT_TOP_K,
    )


def _resolve(row: OrgSettings | None) -> EffectiveSettings:
    defaults = default_settings()
    if row is None:
        return defaults
    return EffectiveSettings(
        chat_model=row.chat_model or defaults.chat_model,
        router_model=row.router_model or defaults.router_model,
        chat_service_tier=row.chat_service_tier or defaults.chat_service_tier,
        background_service_tier=row.background_service_tier or defaults.background_service_tier,
        top_k=row.top_k or defaults.top_k,
    )


async def effective_settings(session: AsyncSession, org_id: str) -> EffectiveSettings:
    return _resolve(await session.get(OrgSettings, org_id))


def settings_view(row: OrgSettings | None) -> dict[str, Any]:
    """The GET /settings payload: effective values, stored overrides, defaults, prices."""
    pricing = load_pricing()
    models = chat_models()
    return {
        **asdict(_resolve(row)),
        "overrides": {
            **{key: getattr(row, key) if row else None for key in OVERRIDABLE},
            "top_k": row.top_k if row else None,
        },
        "defaults": asdict(default_settings()),
        "models": models,
        "pricing": {name: pricing[name] for name in models},
        "updated_at": row.updated_at if row else None,
        "updated_by": row.updated_by if row else None,
    }


async def get_settings_view(session: AsyncSession, org_id: str) -> dict[str, Any]:
    return settings_view(await session.get(OrgSettings, org_id))


async def update_settings(
    session: AsyncSession, org_id: str, changes: dict[str, Any], updated_by: str
) -> dict[str, Any]:
    """Upsert the org's overrides. `changes` holds only the fields the client sent; None
    resets a field (models/tiers fall back to the env, top_k to 8)."""
    row = await session.get(OrgSettings, org_id)
    if row is None:
        row = OrgSettings(org_id=org_id, top_k=DEFAULT_TOP_K)
        session.add(row)
    for key, value in changes.items():
        setattr(row, key, DEFAULT_TOP_K if key == "top_k" and value is None else value)
    row.updated_by = updated_by
    await session.commit()
    await session.refresh(row)
    return settings_view(row)
