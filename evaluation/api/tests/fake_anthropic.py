"""A fake `AsyncAnthropic` for judge tests: `client.beta.messages.create(**request)` answers with
canned structured outputs keyed by prompt key (recognized from the request's output schema).

It simulates prompt caching per (model, system): the first request writes the system prompt to
the cache, later ones read it. Token counts are len(text) // 4.
"""

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from anthropic.types.beta import BetaMessage

from app.judge import registry

SOURCE_RE = re.compile(r"^\[(\d+)\] ", re.MULTILINE)
LISTED_RE = re.compile(r"^(\d+)\. ", re.MULTILINE)


@dataclass
class Reply:
    """A non-default reply: a stop reason other than end_turn, raw text, or another model."""

    output: dict[str, Any] | None = None
    stop_reason: str = "end_turn"
    text: str | None = None
    model: str | None = None


def _packet(request: dict[str, Any]) -> str:
    return request["messages"][0]["content"][0]["text"]


def _task(request: dict[str, Any]) -> str:
    return request["messages"][0]["content"][1]["text"]


def default_claims_extract(_request: dict[str, Any]) -> dict[str, Any]:
    return {
        "claims": [
            {"text": "A performance improvement plan lasts 90 days.", "sentence_idx": 0,
             "citation_ns": [1]},
            {"text": "The manager reviews progress every two weeks.", "sentence_idx": 1,
             "citation_ns": []},
        ]
    }  # fmt: skip


def default_claims_verify(request: dict[str, Any]) -> dict[str, Any]:
    count = len(LISTED_RE.findall(_task(request)))
    return {
        "verdicts": [
            {"idx": i, "reasoning": f"Source {i} states it.", "verdict": "supported",
             "supporting_ns": [i], "evidence_quote": "quoted"}
            for i in range(1, count + 1)
        ]
    }  # fmt: skip


def default_key_facts(request: dict[str, Any]) -> dict[str, Any]:
    reference = _packet(request).split("<reference>", 1)[-1].split("</reference>", 1)[0]
    count = len(LISTED_RE.findall(reference))
    return {"facts": [{"idx": i, "reasoning": "Stated.", "entailed": "yes"}
                      for i in range(1, count + 1)]}  # fmt: skip


def default_context_relevance(request: dict[str, Any]) -> dict[str, Any]:
    sources = _packet(request).split("<sources>", 1)[-1].split("</sources>", 1)[0]
    ns = [int(n) for n in SOURCE_RE.findall(sources)]
    return {"chunks": [{"n": n, "reasoning": "On topic.", "relevant": n in (1, 3)} for n in ns]}


DEFAULT_OUTPUTS: dict[str, Callable[[dict[str, Any]], Any] | dict[str, Any]] = {
    "judge.claims_extract": default_claims_extract,
    "judge.claims_verify": default_claims_verify,
    "judge.key_facts": default_key_facts,
    "judge.context_relevance": default_context_relevance,
    "judge.behavior": {
        "reasoning": "It answers from the sources.",
        "behavior": "answered",
        "mentions_owner": True,
        "followed_injected_instruction": False,
    },
    "judge.answer_quality": {
        "analysis": {
            d: "Fine."
            for d in (
                "correctness",
                "completeness",
                "relevance",
                "jurisdiction_handling",
                "refusal_helpfulness",
            )
        },
        "scores": {
            "correctness": None,
            "completeness": 4,
            "relevance": 5,
            "jurisdiction_handling": None,
            "refusal_helpfulness": None,
        },
        "verdict": "pass",
        "summary": "Accurate and grounded.",
        "issues": [],
    },  # fmt: skip
    "judge.followup_resolution": {"reasoning": "Resolved.", "resolved": True, "score": 5},
}


CHUNK_HEADER_RE = re.compile(r"^\[(\d+)\] (\S+) · .*?§(\S+)", re.MULTILINE)


def chunk_sections(request: dict[str, Any]) -> list[tuple[str, str]]:
    """(doc code, section number) of each `<chunks>` header in the packet."""
    packet = _packet(request)
    chunks = (
        packet.split("<chunks>", 1)[-1].split("</chunks>", 1)[0] if "<chunks>" in packet else ""
    )
    return [(code, number) for _, code, number in CHUNK_HEADER_RE.findall(chunks)]


def default_generated(request: dict[str, Any]) -> dict[str, Any]:
    """A valid `GeneratedCase` built from the packet's chunk headers; the question's words come
    from a hash of the packet + task, so different seeds never look like duplicates."""
    sections = chunk_sections(request)
    digest = hashlib.sha256((_packet(request) + _task(request)).encode()).hexdigest()
    words = " ".join(f"w{digest[i : i + 5]}" for i in range(0, 40, 5))
    return {
        "rationale": "The excerpt states it.",
        "question": f"How about {words}?",
        "reference_answer": "Employees get 30 days.",
        "key_facts": [{"fact": "30 days per year.", "weight": 3}],
        "evidence_quotes": [],
        "expected_doc_codes": sorted({code for code, _ in sections}),
        "expected_sections": [f"{code} §{number}" for code, number in sections],
        "expected_jurisdiction": None,
        "expected_behavior": "answer" if sections else "refuse",
    }


DEFAULT_OUTPUTS.update(
    {
        **{
            f"gen.{kind}": default_generated
            for kind in ("single_hop", "multi_hop", "jurisdiction", "comparative",
                         "unanswerable", "out_of_scope")
        },
        "gen.validate": {
            "reasoning": "Grounded and clear.", "answerable_from_sources": True,
            "reference_supported": True, "self_contained": True, "ambiguity": "low",
            "issues": [], "keep": True,
        },
        "gen.enrich_reference": {
            "rationale": "From the section.", "reference_answer": "The plan lasts 90 days.",
            "key_facts": [{"fact": "It lasts 90 days.", "weight": 3}],
            "evidence_quotes": ["lasts 90 days"],
        },
    }
)  # fmt: skip


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class FakeAnthropic:
    def __init__(self, outputs: dict[str, Any] | None = None) -> None:
        self.outputs = {**DEFAULT_OUTPUTS, **(outputs or {})}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.cached: set[tuple[str, str]] = set()
        self.by_schema = {
            _canonical(spec.output_schema): key for key, spec in registry.file_specs().items()
        }
        # Prompts sharing a schema (the gen.* generators) are told apart by their system prompt.
        self.by_system = {spec.system: key for key, spec in registry.file_specs().items()}
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def keys(self) -> list[str]:
        return [key for key, _ in self.calls]

    def key_of(self, request: dict[str, Any]) -> str:
        key = self.by_system.get(request["system"][0]["text"])
        return key or self.by_schema[_canonical(request["output_config"]["format"]["schema"])]

    async def create(self, **request: Any) -> BetaMessage:
        key = self.key_of(request)
        self.calls.append((key, request))
        produced = self.outputs[key]
        produced = produced(request) if callable(produced) else produced
        if isinstance(produced, Exception):
            raise produced
        reply = produced if isinstance(produced, Reply) else Reply(output=produced)
        text = reply.text if reply.text is not None else json.dumps(reply.output or {})
        system = request["system"][0]["text"]
        cache_key = (request["model"], system)
        system_tokens = len(system) // 4
        hit = cache_key in self.cached
        self.cached.add(cache_key)
        return BetaMessage.model_validate(
            {
                "id": f"msg_fake_{len(self.calls)}",
                "type": "message",
                "role": "assistant",
                "model": reply.model or request["model"],
                "content": [{"type": "text", "text": text}],
                "stop_reason": reply.stop_reason,
                "stop_details": (
                    {"type": "refusal", "category": "general_harms", "explanation": "declined"}
                    if reply.stop_reason == "refusal"
                    else None
                ),
                "stop_sequence": None,
                "usage": {
                    "input_tokens": len(_packet(request) + _task(request)) // 4,
                    "output_tokens": max(len(text) // 4, 1),
                    "cache_creation_input_tokens": 0 if hit else system_tokens,
                    "cache_read_input_tokens": system_tokens if hit else 0,
                },
            }
        )
