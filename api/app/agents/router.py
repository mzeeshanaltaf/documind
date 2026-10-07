"""The orchestrator: one structured call that picks the department specialist(s) and the
jurisdiction, rewrites follow-ups into a standalone query, and splits multi-part questions.

Prompt layout (for prompt caching): static instructions, then the org catalog (both in
`instructions`), then the last turns of history, then the question.

When the user scoped the chat to documents, routing is bypassed: only the query is rewritten
(and only if there is history to resolve), and retrieval searches just those documents.
"""

import json
import logging
from dataclasses import asdict, dataclass, field
from typing import Any

from app.agents.catalog import Catalog
from app.ingestion.metadata import GLOBAL, normalize_jurisdiction
from app.llm import client as llm
from app.llm.usage import UsageCtx

logger = logging.getLogger(__name__)

HISTORY_TURNS = 6
HISTORY_CHARS = 1500
MAX_DEPARTMENTS = 3
MAX_SUB_QUERIES = 3


@dataclass
class HistoryTurn:
    role: str  # user | assistant
    content: str


@dataclass
class Route:
    departments: list[str]
    jurisdiction: str | None
    standalone_query: str
    sub_queries: list[str] = field(default_factory=list)
    needs_clarification: bool = False
    clarifying_question: str | None = None
    bypassed: bool = False
    usage_row: Any = None

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("usage_row")
        return data

    @property
    def queries(self) -> list[str]:
        return [self.standalone_query, *self.sub_queries]


ROUTER_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "name": "route",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "departments": {
                "type": "array",
                "items": {"type": "string"},
                "description": "1-3 departments from the catalog; [] if general or unknown.",
            },
            "jurisdiction": {
                "type": ["string", "null"],
                "description": "ISO-3166 alpha-2 code, only if stated or clearly implied.",
            },
            "standalone_query": {"type": "string"},
            "sub_queries": {
                "type": "array",
                "items": {"type": "string"},
                "description": "0-3 self-contained parts of a multi-part question.",
            },
            "needs_clarification": {"type": "boolean"},
            "clarifying_question": {"type": ["string", "null"]},
        },
        "required": [
            "departments",
            "jurisdiction",
            "standalone_query",
            "sub_queries",
            "needs_clarification",
            "clarifying_question",
        ],
    },
}

REWRITE_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "name": "rewrite",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {"standalone_query": {"type": "string"}},
        "required": ["standalone_query"],
    },
}

ROUTER_INSTRUCTIONS = """\
You route employee questions about company policies to department specialists. The company's
document catalog is below. Return JSON only.

- departments: 1-3 departments from the catalog whose documents answer the question, most
  relevant first. Use [] only for greetings or questions no department covers. Pick the
  department by subject (leave, pay, conduct at work → HR; devices, accounts, AI tools, data
  security → IT; expenses, reimbursements, budgets → Finance; buying, vendors, purchase
  approvals → Procurement; offices, visitors, desks, parking, pets → Facilities; ethics,
  bribery, gifts, speaking up, whistleblowing → Compliance; company structure, entities,
  leadership → Corporate; cross-border work, travel abroad, foreign entities → International).
  Add a second department when the question clearly spans both.
- jurisdiction: an ISO-3166 alpha-2 code (GB, not UK) only if the user states or clearly
  implies a country (a country, city or office name, a local law, a local currency). Use null
  otherwise; never guess from the language of the question.
- standalone_query: the question rewritten to be self-contained, resolving pronouns and
  references from the conversation (e.g. "and in France?" after a German leave question →
  "How much paid annual leave do employees in France get?"). Keep the user's wording and
  any document codes or section numbers. Do not answer it.
- sub_queries: for a question with several distinct parts, up to 3 self-contained
  sub-questions (one per part); [] for a single question.
- needs_clarification / clarifying_question: set true only if ALL hold: the answer materially
  differs by country, the user gave no hint of their country, and the catalog has several
  country versions for this topic. Even then prefer false — the assistant answers with the
  base policy and notes country variations. If true, ask one short question offering the
  catalog's countries.

# Catalog
"""

REWRITE_INSTRUCTIONS = """\
Rewrite the user's latest message as a self-contained question, resolving pronouns and
references from the conversation. Keep their wording, document codes and section numbers.
Do not answer it. Return JSON only.
"""


def history_input(history: list[HistoryTurn], question: str) -> list[dict[str, Any]]:
    turns = history[-HISTORY_TURNS:]
    messages: list[dict[str, Any]] = [
        {"role": turn.role, "content": turn.content[:HISTORY_CHARS] or "(empty)"}
        for turn in turns
        if turn.role in ("user", "assistant")
    ]
    messages.append({"role": "user", "content": f"Question: {question}"})
    return messages


def normalize_route(raw: dict[str, Any], catalog: Catalog, question: str) -> Route:
    """Keep only catalog departments, a country jurisdiction, distinct sub-queries, and apply
    the clarification policy."""
    known = {d.lower(): d for d in catalog.departments}
    departments: list[str] = []
    for value in raw.get("departments") or []:
        department = known.get(str(value).strip().lower())
        if department and department not in departments:
            departments.append(department)
    departments = departments[:MAX_DEPARTMENTS]

    jurisdiction = normalize_jurisdiction(raw.get("jurisdiction"))
    if jurisdiction == GLOBAL:
        jurisdiction = None

    standalone = (raw.get("standalone_query") or "").strip() or question
    sub_queries: list[str] = []
    for value in raw.get("sub_queries") or []:
        query = str(value).strip()
        if query and query.lower() != standalone.lower() and query not in sub_queries:
            sub_queries.append(query)

    countries = catalog.jurisdictions_for(departments) - {GLOBAL}
    clarifying = (raw.get("clarifying_question") or "").strip() or None
    needs_clarification = bool(
        raw.get("needs_clarification")
        and clarifying
        and jurisdiction is None
        and len(countries) > 1
    )
    return Route(
        departments=departments,
        jurisdiction=jurisdiction,
        standalone_query=standalone,
        sub_queries=sub_queries[:MAX_SUB_QUERIES],
        needs_clarification=needs_clarification,
        clarifying_question=clarifying if needs_clarification else None,
    )


async def route(
    question: str,
    history: list[HistoryTurn],
    catalog: Catalog,
    *,
    model: str,
    tier: str,
    ctx: UsageCtx,
) -> Route:
    response, row = await llm.respond(
        model=model,
        input=history_input(history, question),
        instructions=ROUTER_INSTRUCTIONS + catalog.render(),
        text_format=ROUTER_SCHEMA,
        tier=tier,
        operation="router",
        ctx=ctx,
    )
    try:
        raw = json.loads(response.output_text)
    except (TypeError, ValueError):
        logger.warning("Router returned invalid JSON; searching everything")
        raw = {}
    result = normalize_route(raw, catalog, question)
    result.usage_row = row
    return result


async def rewrite_only(
    question: str,
    history: list[HistoryTurn],
    *,
    model: str,
    tier: str,
    ctx: UsageCtx,
) -> Route:
    """Document-scoped chat: no routing; rewrite the question only when there is history."""
    result = Route(departments=[], jurisdiction=None, standalone_query=question, bypassed=True)
    if not history:
        return result
    response, row = await llm.respond(
        model=model,
        input=history_input(history, question),
        instructions=REWRITE_INSTRUCTIONS,
        text_format=REWRITE_SCHEMA,
        tier=tier,
        operation="router",
        ctx=ctx,
    )
    try:
        rewritten = (json.loads(response.output_text).get("standalone_query") or "").strip()
    except (TypeError, ValueError, AttributeError):
        rewritten = ""
    result.standalone_query = rewritten or question
    result.usage_row = row
    return result
