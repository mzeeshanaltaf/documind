"""The synthesizer: one streamed call that answers from the numbered sources with [n] citations.

Prompt layout (for prompt caching): the static rules first, then the specialist personas and
the policy owners, then recent history, then the sources and the question.
"""

from collections.abc import Sequence
from typing import Any

from app.agents.router import HistoryTurn
from app.agents.specialists import specialist_instructions
from app.llm import client as llm
from app.llm.client import ResponseStream
from app.llm.usage import UsageCtx
from app.rag.hybrid import Source

ANSWER_HISTORY_TURNS = 4
HISTORY_CHARS = 1500

ANSWER_RULES = """\
You answer employees' questions about their company's policies.

Rules:
- Answer only from the numbered sources in the user's message. Never use outside knowledge
  and never invent numbers, dates, names or thresholds.
- Cite every factual sentence with the source number in square brackets, e.g. [2]. Combine
  several as [1][3]. Put citations at the end of the sentence or bullet they support. Only
  cite numbers that appear in the sources.
- If the sources don't contain the answer, say so plainly in one or two sentences and suggest
  who owns the policy (from the policy owners list); don't guess.
- Call out jurisdiction differences: when sources from different countries or a country
  manual and the base manual disagree, say which rule applies to whom. If the user's country
  is unknown and the answer differs by country, give the base policy and briefly note the
  country variations.
- Be concise. Use Markdown: a one-sentence direct answer first, then bullets; a small table
  when comparing countries or tiers. No preamble, no closing offer of further help.
"""


def answer_instructions(departments: list[str], owners: list[str]) -> str:
    parts = [ANSWER_RULES, specialist_instructions(departments)]
    if owners:
        parts.append("Policy owners:\n" + "\n".join(f"- {line}" for line in owners))
    return "\n\n".join(parts)


def format_source(source: Source) -> str:
    """`[n] {doc_code} · {title} · §{number} {title} · p.{start}-{end}` + the chunk text."""
    parts = [f"[{source.n}] {source.doc_code or 'Document'}", source.title]
    if source.jurisdiction:
        parts[-1] += f" ({source.jurisdiction})"
    section = " ".join(
        part
        for part in (
            f"§{source.section_number}" if source.section_number else None,
            source.section_title,
        )
        if part
    )
    if section:
        parts.append(section)
    if source.page_start is not None:
        pages = f"p.{source.page_start}"
        if source.page_end and source.page_end != source.page_start:
            pages += f"-{source.page_end}"
        parts.append(pages)
    return f"{' · '.join(parts)}\n{source.text}"


def answer_input(
    question: str,
    sources: Sequence[Source],
    history: list[HistoryTurn],
    *,
    standalone_query: str | None = None,
    jurisdiction: str | None = None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [
        {"role": turn.role, "content": turn.content[:HISTORY_CHARS] or "(empty)"}
        for turn in history[-ANSWER_HISTORY_TURNS:]
        if turn.role in ("user", "assistant")
    ]
    block = "\n\n".join(format_source(source) for source in sources) or "(no sources found)"
    lines = [f"Sources:\n\n{block}", f"Question: {question}"]
    if standalone_query and standalone_query.strip() != question.strip():
        lines.append(f"(Interpreted as: {standalone_query})")
    if jurisdiction:
        lines.append(f"(The user is asking about jurisdiction {jurisdiction}.)")
    messages.append({"role": "user", "content": "\n\n".join(lines)})
    return messages


def synthesize(
    question: str,
    sources: Sequence[Source],
    history: list[HistoryTurn],
    *,
    departments: list[str],
    owners: list[str],
    standalone_query: str | None,
    jurisdiction: str | None,
    model: str,
    tier: str,
    ctx: UsageCtx,
) -> ResponseStream:
    """The streamed answer; iterate it for text deltas (usage is metered as `answer`)."""
    return llm.stream_respond(
        model=model,
        input=answer_input(
            question,
            sources,
            history,
            standalone_query=standalone_query,
            jurisdiction=jurisdiction,
        ),
        instructions=answer_instructions(departments, owners),
        tier=tier,
        operation="answer",
        ctx=ctx,
    )
