from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.org_settings import OrgSettings


@dataclass(frozen=True)
class EffectiveSettings:
    """Per-org settings with NULL columns resolved to the env defaults."""

    chat_model: str
    router_model: str
    chat_service_tier: str
    background_service_tier: str
    top_k: int


async def effective_settings(session: AsyncSession, org_id: str) -> EffectiveSettings:
    env = get_settings()
    row = await session.get(OrgSettings, org_id)
    return EffectiveSettings(
        chat_model=(row and row.chat_model) or env.openai_chat_model,
        router_model=(row and row.router_model) or env.openai_router_model,
        chat_service_tier=(row and row.chat_service_tier) or env.openai_chat_service_tier,
        background_service_tier=(row and row.background_service_tier)
        or env.openai_background_service_tier,
        top_k=row.top_k if row else 8,
    )
