from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.llm.pricing import chat_models

Tier = Literal["standard", "flex", "auto"]
TOP_K_MIN, TOP_K_MAX = 4, 15


class SettingsValues(BaseModel):
    chat_model: str
    router_model: str
    chat_service_tier: Tier
    background_service_tier: Tier
    top_k: int


class SettingsOut(SettingsValues):
    """Effective values, what's stored (null = env default), the env defaults, and prices."""

    overrides: dict[str, Any]
    defaults: SettingsValues
    models: list[str]
    pricing: dict[str, dict[str, dict[str, float]]]
    updated_at: datetime | None
    updated_by: str | None


class SettingsUpdate(BaseModel):
    """Omitted fields stay as they are; null resets a field to its default."""

    model_config = ConfigDict(extra="forbid")

    chat_model: str | None = None
    router_model: str | None = None
    chat_service_tier: Tier | None = None
    background_service_tier: Tier | None = None
    top_k: int | None = Field(default=None, ge=TOP_K_MIN, le=TOP_K_MAX)

    @field_validator("chat_model", "router_model")
    @classmethod
    def _known_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        models = chat_models()
        if value not in models:
            raise ValueError(f"unknown model; use one of: {', '.join(models)}")
        return value
