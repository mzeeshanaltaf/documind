"""SQLAlchemy models. Importing this package registers every table on `metadata`."""

from app.models.auth import BETTER_AUTH_TABLES, member_table, organization_table, user_table
from app.models.base import Base, metadata
from app.models.chat import Conversation, Message
from app.models.document import (
    EMBEDDING_DIM,
    Bm25Stats,
    Chunk,
    ChunkTerm,
    Document,
    IngestionJob,
)
from app.models.org_settings import OrgSettings
from app.models.quota import QuotaUsage, UserQuota
from app.models.request_log import ApiRequestLog
from app.models.usage import LlmUsage

__all__ = [
    "BETTER_AUTH_TABLES",
    "ApiRequestLog",
    "EMBEDDING_DIM",
    "Base",
    "Bm25Stats",
    "Chunk",
    "ChunkTerm",
    "Conversation",
    "Document",
    "IngestionJob",
    "LlmUsage",
    "Message",
    "OrgSettings",
    "QuotaUsage",
    "UserQuota",
    "member_table",
    "metadata",
    "organization_table",
    "user_table",
]
