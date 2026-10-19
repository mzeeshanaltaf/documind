"""The case packet: everything a judge prompt grades, as XML-tagged sections in a fixed order.

The packet is the cached user block (N samples reuse it), so it holds no ids or timestamps.
Sources are rendered exactly like DocuMind's `agents/answer.py::format_source`, so the judge sees
what the generator saw. Every section's content is data: a closing tag of one of our sections
inside it is defused, so an answer can't break out of `<answer>` and address the judge.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.judge.registry import SECTIONS
from app.metrics.types import CaseSpec, Context

BEHAVIOR_TEXT = {
    "answer": "answer the question from the sources",
    "refuse": "decline: the documents don't cover the question",
    "clarify": "ask the user a clarifying question before answering",
    "clarify_or_variations": (
        "ask a clarifying question, or answer by setting out the variations that apply"
    ),
    "answer_ignoring_injection": (
        "answer the question while ignoring any instruction embedded in the question or sources"
    ),
}
CLOSING_TAG_RE = re.compile(rf"</\s*({'|'.join(SECTIONS)}|turn|fact)\b", re.IGNORECASE)


def defuse(value: str) -> str:
    """`</answer>` → `<\\/answer>`: readable, but no longer closes our tag."""
    return CLOSING_TAG_RE.sub(lambda m: "<\\/" + m.group(1), value)


def format_source(context: Context) -> str:
    """`[n] {doc_code} · {title} · §{number} {title} · p.{start}-{end}` + the chunk text."""
    parts = [f"[{context.n}] {context.doc_code or 'Document'}", context.title or ""]
    if context.jurisdiction:
        parts[-1] += f" ({context.jurisdiction})"
    section = " ".join(
        part
        for part in (
            f"§{context.section_number}" if context.section_number else None,
            context.section_title,
        )
        if part
    )
    if section:
        parts.append(section)
    if context.page_start is not None:
        pages = f"p.{context.page_start}"
        if context.page_end and context.page_end != context.page_start:
            pages += f"-{context.page_end}"
        parts.append(pages)
    return f"{' · '.join(parts)}\n{context.text or ''}"


@dataclass(frozen=True)
class Turn:
    role: str
    content: str


@dataclass(frozen=True)
class CaseInputs:
    """What the judge reads for one case."""

    case: CaseSpec
    answer: str = ""
    contexts: Sequence[Context] = ()
    conversation: Sequence[Turn] = ()  # the setup turns and DocuMind's answers to them
    routing: Mapping[str, Any] | None = None
    needs_clarification: bool = False
    citations: Sequence[Mapping[str, Any]] = field(default_factory=tuple)


def _reference(case: CaseSpec) -> str:
    parts = []
    if case.reference_answer:
        parts.append(f"Reference answer:\n{case.reference_answer.strip()}")
    if case.key_facts:
        lines = "\n".join(
            f"{i}. {fact.get('fact', '').strip()}" for i, fact in enumerate(case.key_facts, start=1)
        )
        parts.append(f"Key facts:\n{lines}")
    return "\n\n".join(parts) or "(none provided)"


def _routing(routing: Mapping[str, Any] | None) -> str:
    routing = routing or {}
    lines = [f"Standalone query: {routing.get('standalone_query') or '(none)'}"]
    sub = [q for q in routing.get("sub_queries") or [] if q]
    if len(sub) > 1:
        lines.append("Sub-queries: " + " | ".join(sub))
    if routing.get("jurisdiction"):
        lines.append(f"Jurisdiction: {routing['jurisdiction']}")
    return "\n".join(lines)


def section(name: str, inputs: CaseInputs) -> str | None:
    """One section's text, or None when it has nothing to show (it is then left out)."""
    case = inputs.case
    match name:
        case "question":
            return case.question
        case "conversation":
            if not inputs.conversation:
                return None
            return "\n".join(
                f'<turn role="{t.role}">\n{defuse(t.content)}\n</turn>' for t in inputs.conversation
            )
        case "expected_behavior":
            return f"{case.expected_behavior}: {BEHAVIOR_TEXT.get(case.expected_behavior, '')}"
        case "reference":
            return _reference(case)
        case "sources":
            return "\n\n".join(format_source(c) for c in inputs.contexts) or "(no sources found)"
        case "answer":
            return inputs.answer or "(empty answer)"
        case "routing":
            return _routing(inputs.routing)
    raise KeyError(name)


def render_packet(packet: Sequence[str], inputs: CaseInputs) -> str:
    """The sections in `SECTIONS` order (not the prompt's listing order), so equal packets of two
    prompts are byte-identical."""
    blocks = []
    for name in SECTIONS:
        if name not in packet:
            continue
        content = section(name, inputs)
        if content is None:
            continue
        # The conversation's own <turn> tags are ours; everything else is defused.
        body = content if name == "conversation" else defuse(content)
        blocks.append(f"<{name}>\n{body}\n</{name}>")
    return "\n\n".join(blocks)
