"""Per-call cost from `model-pricing.json` ($ per 1M tokens, keyed by model then tier)."""

import json
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from typing import Any

from app.core.config import get_settings

MILLION = Decimal(1_000_000)
STANDARD = "standard"

# Request (settings or API) and response tier names → pricing keys. OpenAI reports standard as
# "default" (never "standard"); `auto` requests come back as "default" too.
_TIER_KEYS = {"default": STANDARD, "standard": STANDARD, "flex": "flex"}


@dataclass(frozen=True)
class Cost:
    usd: Decimal
    estimated: bool  # True when the exact model/tier wasn't in the pricing file


@lru_cache
def load_pricing() -> dict[str, dict[str, dict[str, Any]]]:
    return json.loads(get_settings().pricing_file.read_text(encoding="utf-8"))


def chat_models() -> list[str]:
    """Models in the pricing file usable for chat/routing (embedding models excluded)."""
    return [name for name in load_pricing() if not name.startswith("text-embedding")]


def pricing_tier(tier: str | None) -> str | None:
    """Pricing key for a tier name; None for an unknown tier. No tier (embeddings) = standard."""
    return STANDARD if tier is None else _TIER_KEYS.get(tier)


def cost(model: str, tier: str | None, input_tokens: int, cached: int, output: int) -> Cost:
    model_prices = load_pricing().get(model)
    if not model_prices:
        return Cost(Decimal(0), estimated=True)

    key = pricing_tier(tier)
    estimated = key is None or key not in model_prices
    prices = model_prices[STANDARD] if estimated else model_prices[key]  # type: ignore[index]

    def rate(name: str) -> Decimal:
        return Decimal(str(prices.get(name, 0)))

    cached = min(cached, input_tokens)
    usd = (
        (input_tokens - cached) * rate("inputPerMillion")
        + cached * rate("cachedInputPerMillion")
        + output * rate("outputPerMillion")
    ) / MILLION
    return Cost(usd, estimated)
