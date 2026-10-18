from datetime import date

from pydantic import BaseModel, ConfigDict, Field

MAX_MESSAGE_LIMIT = 1_000_000
MAX_TOKEN_LIMIT = 10_000_000_000


class QuotaOut(BaseModel):
    """One user's monthly allowance and what's been used since `period_start` (UTC)."""

    user_id: str
    message_limit: int
    token_limit: int
    messages_used: int
    tokens_used: int
    period_start: date
    resets_on: date = Field(description="First day of the next month (UTC).")
    is_custom: bool = Field(description="False while the user is on the default allowance.")
    unlimited: bool = Field(description="Platform admins aren't limited.")
    exhausted: str | None = Field(description="'messages' or 'tokens' once a limit is reached.")


class QuotaIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_limit: int = Field(ge=0, le=MAX_MESSAGE_LIMIT)
    token_limit: int = Field(ge=0, le=MAX_TOKEN_LIMIT)


class QuotaDefaults(BaseModel):
    message_limit: int
    token_limit: int


class QuotaListOut(BaseModel):
    quotas: list[QuotaOut]
    defaults: QuotaDefaults
