from decimal import Decimal

from app.llm.client import api_tier
from app.llm.pricing import cost, pricing_tier


def test_luna_standard_with_cached_input() -> None:
    price = cost("gpt-6-luna", "standard", 1_000_000, 200_000, 100_000)
    # 0.8M × $0.10 + 0.2M × $0.01 + 0.1M × $0.50
    assert price.usd == Decimal("0.132")
    assert price.estimated is False


def test_default_tier_is_priced_as_standard() -> None:
    assert cost("gpt-6-luna", "default", 1_000_000, 200_000, 100_000).usd == Decimal("0.132")


def test_flex_halves_it() -> None:
    price = cost("gpt-6-luna", "flex", 1_000_000, 200_000, 100_000)
    assert price.usd == Decimal("0.066")
    assert price.estimated is False


def test_unknown_tier_is_standard_and_estimated() -> None:
    price = cost("gpt-6-luna", "priority", 1_000_000, 200_000, 100_000)
    assert price.usd == Decimal("0.132")
    assert price.estimated is True


def test_model_without_flex_prices_flex_at_standard_estimated() -> None:
    price = cost("text-embedding-3-small", "flex", 1_000_000, 0, 0)
    assert price.usd == Decimal("0.02")
    assert price.estimated is True


def test_unknown_model_is_free_and_estimated() -> None:
    price = cost("no-such-model", "standard", 1000, 0, 1000)
    assert price.usd == Decimal(0)
    assert price.estimated is True


def test_embedding_without_tier() -> None:
    price = cost("text-embedding-3-small", None, 500_000, 0, 0)
    assert price.usd == Decimal("0.01")
    assert price.estimated is False


def test_tier_mappings() -> None:
    assert pricing_tier("default") == "standard"
    assert pricing_tier("flex") == "flex"
    assert pricing_tier("auto") is None
    assert api_tier("standard") == "default"
    assert api_tier("flex") == "flex"
    assert api_tier("auto") == "auto"
