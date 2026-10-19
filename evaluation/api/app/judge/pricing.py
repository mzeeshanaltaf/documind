"""Judge cost from `judge-pricing.json` ($ per 1M tokens per model). A call is priced at the model
that actually served it: with a server-side fallback each `usage.iterations` entry carries its
own model and tokens."""

import json
from dataclasses import dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any

PRICING_FILE = Path(__file__).resolve().parents[2] / "judge-pricing.json"
MILLION = Decimal(1_000_000)
RATE_KEYS = ("input", "output", "cache_write_5m", "cache_write_1h", "cache_read")


class UnknownModelError(KeyError):
    pass


@dataclass(frozen=True)
class Tokens:
    """One priced chunk of usage. `input` excludes cache writes and reads (Anthropic's
    `input_tokens` is the uncached tail)."""

    input: int = 0
    output: int = 0
    cache_write_5m: int = 0
    cache_write_1h: int = 0
    cache_read: int = 0

    @property
    def cache_write(self) -> int:
        return self.cache_write_5m + self.cache_write_1h

    @property
    def prompt(self) -> int:
        return self.input + self.cache_write + self.cache_read

    def __add__(self, other: "Tokens") -> "Tokens":
        return Tokens(*(getattr(self, k) + getattr(other, k) for k in RATE_KEYS))


@lru_cache
def pricing() -> dict[str, dict[str, Any]]:
    return json.loads(PRICING_FILE.read_text(encoding="utf-8"))["models"]


def known(model: str) -> bool:
    return model in pricing()


def rates(model: str, prompt_tokens: int = 0) -> dict[str, Decimal]:
    try:
        entry = pricing()[model]
    except KeyError as exc:
        raise UnknownModelError(model) from exc
    long = entry.get("long_context")
    if long and prompt_tokens > long["above_input_tokens"]:
        entry = long
    return {key: Decimal(str(entry[key])) for key in RATE_KEYS}


def cost_usd(model: str, tokens: Tokens) -> Decimal:
    rate = rates(model, tokens.prompt)
    total = sum((Decimal(getattr(tokens, key)) * rate[key] for key in RATE_KEYS), Decimal(0))
    return (total / MILLION).quantize(Decimal("0.00000001"))
