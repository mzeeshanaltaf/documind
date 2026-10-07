"""Retrieval eval: hit@5, hit@8 and MRR@8 for BM25-only, vector-only and hybrid retrieval, plus
routing accuracy, over `eval/golden.jsonl`. No answers are generated.

Every question goes through the live router (as in chat) and one query embedding; the three
modes then run the same pipeline (filters, fusion, boost, de-dup, selection) on their lists.

    uv run python -m eval.run_eval --org-slug simtora [--top-k 8] [--out eval/results]

A hit is a selected source from an expected document — and, when `expected_sections` is given,
from one of those sections (`"SIM-HR-001 §3.1"`, exact section number).
"""

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.agents.catalog import get_org_catalog
from app.agents.router import route
from app.core.db import SessionLocal, engine
from app.llm import client as llm
from app.llm.usage import UsageCtx
from app.models.auth import organization_table
from app.rag.hybrid import Mode, SearchFilter, Source, retrieve
from app.services.org_settings import effective_settings

EVAL_DIR = Path(__file__).resolve().parent
MODES: tuple[Mode, ...] = ("bm25", "vector", "hybrid")
CONCURRENCY = 3


@dataclass
class Golden:
    question: str
    expected_doc_codes: list[str]
    expected_sections: list[str] = field(default_factory=list)
    jurisdiction: str | None = None


@dataclass
class Outcome:
    golden: Golden
    departments: list[str]
    expected_departments: set[str]
    jurisdiction: str | None
    queries: list[str]
    ranks: dict[str, int | None]  # mode → 1-based rank of the first hit (None = miss)
    top: dict[str, list[str]]  # mode → "CODE §n" of the first sources

    @property
    def routed_ok(self) -> bool:
        return not self.expected_departments or bool(
            self.expected_departments & set(self.departments)
        )


def load_golden(path: Path) -> list[Golden]:
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [Golden(**json.loads(line)) for line in lines]


def label(source: Source) -> str:
    return f"{source.doc_code} §{source.section_number or '-'}"


def is_hit(source: Source, golden: Golden) -> bool:
    if source.doc_code not in golden.expected_doc_codes:
        return False
    if not golden.expected_sections:
        return True
    return f"{source.doc_code} §{source.section_number}" in golden.expected_sections


def first_hit(sources: list[Source], golden: Golden, k: int) -> int | None:
    for rank, source in enumerate(sources[:k], start=1):
        if is_hit(source, golden):
            return rank
    return None


async def evaluate_one(
    golden: Golden, org_id: str, catalog: Any, settings: Any, top_k: int
) -> Outcome:
    ctx = UsageCtx(org_id=org_id)
    routed = await route(
        golden.question,
        [],
        catalog,
        model=settings.router_model,
        tier=settings.chat_service_tier,
        ctx=ctx,
    )
    queries = routed.queries
    vectors = await llm.embed(queries, operation="embed_query", ctx=ctx)
    filters = [SearchFilter(departments=(d,)) for d in routed.departments] or [SearchFilter()]
    ranks: dict[str, int | None] = {}
    top: dict[str, list[str]] = {}
    for mode in MODES:
        result = await retrieve(
            org_id,
            queries,
            vectors,
            filters,
            jurisdiction=routed.jurisdiction,
            top_k=top_k,
            mode=mode,
        )
        ranks[mode] = first_hit(result.sources, golden, top_k)
        top[mode] = [label(s) for s in result.sources[:top_k]]
    departments_by_code = {d.doc_code: d.department for d in catalog.documents}
    expected_departments = {
        departments_by_code[code]
        for code in golden.expected_doc_codes
        if departments_by_code.get(code)
    }
    return Outcome(
        golden=golden,
        departments=routed.departments,
        expected_departments=expected_departments,
        jurisdiction=routed.jurisdiction,
        queries=queries,
        ranks=ranks,
        top=top,
    )


def metrics(outcomes: list[Outcome], mode: str) -> dict[str, float]:
    n = len(outcomes) or 1
    ranks = [o.ranks[mode] for o in outcomes]
    return {
        "hit@5": sum(1 for r in ranks if r is not None and r <= 5) / n,
        "hit@8": sum(1 for r in ranks if r is not None and r <= 8) / n,
        "mrr": sum(1 / r for r in ranks if r is not None) / n,
    }


def render_report(
    outcomes: list[Outcome], org_slug: str, settings: Any, top_k: int, elapsed_s: float
) -> str:
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    n = len(outcomes)
    routed = sum(1 for o in outcomes if o.routed_ok)
    with_juris = [o for o in outcomes if o.golden.jurisdiction]
    juris_ok = sum(1 for o in with_juris if o.jurisdiction == o.golden.jurisdiction)
    lines = [
        f"# Retrieval eval — {stamp}",
        "",
        f"- Org: `{org_slug}` · questions: {n} · top_k: {top_k} · router: "
        f"`{settings.router_model}` ({settings.chat_service_tier}) · run time {elapsed_s:.0f} s",
        "- Hit = a selected source from an expected document/section; MRR is over the top "
        f"{top_k} (a miss scores 0).",
        "",
        "| Mode | hit@5 | hit@8 | MRR |",
        "|---|---|---|---|",
    ]
    for mode in MODES:
        m = metrics(outcomes, mode)
        lines.append(f"| {mode} | {m['hit@5']:.3f} | {m['hit@8']:.3f} | {m['mrr']:.3f} |")
    lines += [
        "",
        f"- Routing accuracy (an expected department was routed): {routed}/{n} "
        f"= {routed / (n or 1):.3f}",
        f"- Jurisdiction accuracy (questions with a country): {juris_ok}/{len(with_juris)}",
        "",
        "## Per question",
        "",
        "Rank of the first hit per mode (– = miss within the top k).",
        "",
        "| # | Question | Expected | Routed | BM25 | Vector | Hybrid |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, o in enumerate(outcomes, start=1):
        expected = ", ".join(o.golden.expected_sections or o.golden.expected_doc_codes)
        routing = ", ".join(o.departments) or "(all)"
        if o.jurisdiction:
            routing += f" / {o.jurisdiction}"
        if not o.routed_ok:
            routing += " ✗"
        cells = [str(o.ranks[m]) if o.ranks[m] else "–" for m in MODES]
        lines.append(
            f"| {i} | {o.golden.question} | {expected} | {routing} | {' | '.join(cells)} |"
        )
    misses = [o for o in outcomes if not o.ranks["hybrid"]]
    if misses:
        lines += ["", "## Hybrid misses", ""]
        for o in misses:
            lines.append(f"- **{o.golden.question}** — queries {o.queries}")
            lines.append(f"  - hybrid top: {', '.join(o.top['hybrid'])}")
    return "\n".join(lines) + "\n"


def write_report(out_dir: Path, started: datetime, report: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{started.date().isoformat()}.md"
    path.write_text(report, encoding="utf-8")
    return path


async def main(args: argparse.Namespace) -> int:
    async with SessionLocal() as session:
        org_id = (
            await session.execute(
                select(organization_table.c.id).where(organization_table.c.slug == args.org_slug)
            )
        ).scalar_one_or_none()
        if org_id is None:
            print(f"No organization with slug {args.org_slug!r}", file=sys.stderr)
            return 1
        settings = await effective_settings(session, org_id)
    top_k = args.top_k or settings.top_k
    catalog = await get_org_catalog(org_id)
    golden = load_golden(Path(args.golden))
    if args.limit:
        golden = golden[: args.limit]

    started = datetime.now(UTC)
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def run(item: Golden) -> Outcome:
        async with semaphore:
            return await evaluate_one(item, org_id, catalog, settings, top_k)

    outcomes = list(await asyncio.gather(*(run(item) for item in golden)))
    elapsed = (datetime.now(UTC) - started).total_seconds()

    report = render_report(outcomes, args.org_slug, settings, top_k, elapsed)
    path = write_report(Path(args.out), started, report)
    for mode in MODES:
        m = metrics(outcomes, mode)
        print(f"{mode:>7}: hit@5 {m['hit@5']:.3f}  hit@8 {m['hit@8']:.3f}  MRR {m['mrr']:.3f}")
    routed = sum(1 for o in outcomes if o.routed_ok)
    print(f"routing: {routed}/{len(outcomes)}  → {path}")
    await engine.dispose()
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--org-slug", required=True)
    parser.add_argument("--golden", default=str(EVAL_DIR / "golden.jsonl"))
    parser.add_argument("--out", default=str(EVAL_DIR / "results"))
    parser.add_argument("--top-k", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None, help="Only the first N questions.")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(parse_args())))
