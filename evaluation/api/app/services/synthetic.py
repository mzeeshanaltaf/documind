"""Synthetic batches (E7): chunk sampling, batch creation and reads.

**Sampling** (pure, reproducible: `random.Random(seed)` over chunks sorted by doc code and chunk
index, so the same chunks and seed give the same seeds):
- Eligible chunks have a section number, ≥ 80 tokens and a `content_type` other than
  `revision_history`/`glossary`.
- `single_hop`: one chunk; the count is spread over the selected documents in proportion to their
  eligible chunks, at least one each when there are enough.
- `multi_hop`: two chunks, either across documents (a chunk whose text cites another selected
  document's code, paired with that document's most similar chunk) or from two sections of one
  document (sibling sections preferred).
- `jurisdiction`: a company-wide chunk paired with a country-supplement chunk of the same
  department whose section titles match (`titles_match`).
- `comparative`: the same matched topic in two country supplements.
- `unanswerable` / `out_of_scope`: no chunk; an area or theme hint, and the org's catalog.
Types are interleaved round-robin, so a partial batch still covers every type. Chunks already
used are avoided while unused ones remain.

**Creation** fetches the chunks from DocuMind's E1 endpoint, records the gen.* prompt versions,
inserts the candidates with their seeds and enqueues one `synthetic_generate` job each.
"""

import asyncio
import random
import re
import uuid
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import case as sql_case
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.documind.client import DocuMindClient
from app.documind.models import Document
from app.judge import offline, registry
from app.models import Case, Dataset, DatasetVersion, SyntheticBatch, SyntheticCandidate
from app.schemas.synthetic import BatchIn
from app.services import datasets as dataset_service
from app.services.synthetic_checks import content_tokens

TYPES = ("single_hop", "multi_hop", "jurisdiction", "comparative", "unanswerable", "out_of_scope")
CHUNK_TYPES = frozenset({"single_hop", "multi_hop", "jurisdiction", "comparative"})
REFUSING_TYPES = frozenset({"unanswerable", "out_of_scope"})
EXCLUDED_CONTENT = frozenset({"revision_history", "glossary"})
MIN_TOKENS = 80
SUPPLEMENT = "country_supplement"
DOC_CODE_RE = re.compile(r"\b[A-Z]{2,5}-[A-Z]{2,5}-\d{3}\b")
# Title words that don't identify a topic ("Sick Leave" ~ "Sick and Safe Leave"; "pay" would
# pair "Pay and Payroll" with "Sick Leave and Sick Pay"). Matched after a plural "s" is cut.
GENERIC_TITLE_WORDS = frozenset(
    "leave policy policie procedure management other general rule arrangement requirement "
    "company work worker working employee employment pay paid by outside united state form "
    "checklist summary key term right standard global local specific add on review location "
    "across time".split()
)
COUNTRY_NAMES = {
    "PK": "Pakistan", "DE": "Germany", "FR": "France", "AU": "Australia",
    "GB": "the United Kingdom", "US": "the United States",
}  # fmt: skip
ANGLES = (
    "employee discounts and perks", "company social events and parties", "parking and commuting",
    "bringing pets or children to the office", "sabbaticals and career breaks",
    "volunteering days and charity matching", "personal use of company property",
    "gym, wellness apps and fitness subsidies", "office kitchen, snacks and meals",
    "service anniversaries and long-service awards", "side businesses and freelancing",
    "company merchandise and branded items", "recording or transcribing meetings",
    "music, headphones and noise at desks", "smoking and vaping areas",
    "birthday leave and celebrations", "referral bonuses for hiring friends",
    "standing desks and ergonomic equipment", "language classes", "company cars",
)  # fmt: skip
THEMES = (
    "cooking and recipes", "sports results and rules", "planning a holiday trip",
    "maths or homework help", "programming help", "film and book recommendations",
    "the weather", "history trivia", "personal investing", "gardening",
    "fitness and diet tips", "translating a phrase", "writing a birthday message",
    "buying a new phone or laptop", "science facts", "music", "riddles and puzzles",
    "car maintenance", "pet care", "geography",
)  # fmt: skip
COST_PER_CANDIDATE = {"synthetic": Decimal("0.07"), "enrichment": Decimal("0.05")}
# The default cap leaves room above the estimate (Opus thinking varies).
DEFAULT_CAP_FACTOR = Decimal(2)
LOCK_SALT = 0x73796E  # "syn": advisory lock namespace for a batch's dedupe-and-save
CHUNK_FETCH_CONCURRENCY = 4


# --- chunks ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SeedChunk:
    chunk_id: str
    document_id: str
    doc_code: str
    title: str
    department: str | None
    jurisdiction: str | None
    doc_type: str | None
    chunk_index: int
    section_number: str | None
    section_title: str | None
    page_start: int | None
    page_end: int | None
    content_type: str | None
    token_count: int
    text: str

    @property
    def supplement(self) -> bool:
        return self.doc_type == SUPPLEMENT

    @property
    def section(self) -> str:
        return f"{self.doc_code} §{self.section_number}"

    @property
    def top_section(self) -> str:
        return (self.section_number or "").split(".")[0]

    def excerpt(self, n: int, role: str = "seed") -> dict[str, Any]:
        return {
            "n": n,
            "role": role,
            "chunk_id": self.chunk_id,
            "document_id": self.document_id,
            "doc_code": self.doc_code,
            "title": self.title,
            "department": self.department,
            "jurisdiction": self.jurisdiction if self.supplement else None,
            "doc_type": self.doc_type,
            "section_number": self.section_number,
            "section_title": self.section_title,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "content_type": self.content_type,
            "text": self.text,
        }


def chunks_from_page(
    document: Mapping[str, Any], rows: Iterable[Mapping[str, Any]]
) -> list[SeedChunk]:
    """`GET …/documents/{doc}/chunks` rows as seed chunks (document metadata denormalized)."""
    return [
        SeedChunk(
            chunk_id=str(row["id"]),
            document_id=str(document["id"]),
            doc_code=document.get("doc_code") or "",
            title=document.get("title") or "",
            department=document.get("department"),
            jurisdiction=document.get("jurisdiction"),
            doc_type=document.get("doc_type"),
            chunk_index=int(row.get("chunk_index") or 0),
            section_number=row.get("section_number"),
            section_title=row.get("section_title"),
            page_start=row.get("page_start"),
            page_end=row.get("page_end"),
            content_type=row.get("content_type"),
            token_count=int(row.get("token_count") or 0),
            text=row.get("text") or "",
        )
        for row in rows
    ]


def eligible(chunk: SeedChunk) -> bool:
    return (
        bool(chunk.section_number)
        and bool(chunk.doc_code)
        and chunk.token_count >= MIN_TOKENS
        and chunk.content_type not in EXCLUDED_CONTENT
    )


def title_tokens(title: str | None) -> set[str]:
    tokens = {
        t[:-1] if len(t) > 3 and t.endswith("s") else t
        for t in content_tokens(title or "")
        if len(t) > 1  # "U.S." and accented words split into letters
    }
    return tokens - GENERIC_TITLE_WORDS


def title_score(a: str | None, b: str | None) -> tuple[float, float]:
    """(containment, Jaccard) of the topic words: "Sick and Safe Leave" ~ "Sick Leave" (1.0),
    "Open Door and Grievance Procedure" ~ "Grievance Procedure" (1.0); "Annual Leave" vs
    "Parental Leave" shares no topic word (0)."""
    ta, tb = title_tokens(a), title_tokens(b)
    if not ta or not tb:
        return 0.0, 0.0
    shared = len(ta & tb)
    return shared / min(len(ta), len(tb)), shared / len(ta | tb)


def titles_match(a: str | None, b: str | None) -> bool:
    return title_score(a, b)[0] >= 0.5


def numbered(section_number: str | None) -> bool:
    """A body section (`5.2`), not an appendix (`A`)."""
    return bool(section_number) and section_number[0].isdigit()  # type: ignore[index]


def best_matches(
    targets: Mapping[tuple[str, str], list["SeedChunk"]],
    pool: Mapping[tuple[str, str], list["SeedChunk"]],
    accept: Any,
) -> list[tuple[list["SeedChunk"], list["SeedChunk"]]]:
    """For each target section, the pool sections whose titles match it best (ties kept);
    `accept(target_head, pool_head)` filters pairs first (same department, other country…)."""
    out = []
    for target_chunks in targets.values():
        head = target_chunks[0]
        scored = []
        for pool_chunks in pool.values():
            other = pool_chunks[0]
            if not accept(head, other):
                continue
            score = title_score(head.section_title, other.section_title)
            if score[0] >= 0.5:
                scored.append((score, pool_chunks))
        if scored:
            top = max(score for score, _ in scored)
            out.extend((chunks, target_chunks) for score, chunks in scored if score == top)
    return out


def country(code: str | None) -> str:
    if not code:
        return "an unspecified country"
    return f"{COUNTRY_NAMES.get(code, code)} ({code})"


# --- allocation --------------------------------------------------------------------------------


def allocate(total: int, weights: Mapping[str, int], rng: random.Random) -> dict[str, int]:
    """Spread `total` over the keys in proportion to their weights (largest remainder), at
    least 1 per key when `total` allows; with fewer than one per key, keys are drawn by weight."""
    keys = sorted(k for k, w in weights.items() if w > 0)
    if total <= 0 or not keys:
        return {}
    if total < len(keys):
        chosen: list[str] = []
        pool = list(keys)
        for _ in range(total):
            pick = rng.choices(pool, weights=[weights[k] for k in pool])[0]
            chosen.append(pick)
            pool.remove(pick)
        return {k: 1 for k in sorted(chosen)}
    out = {k: 1 for k in keys}
    rest = total - len(keys)
    weight_sum = sum(weights[k] for k in keys)
    shares = {k: rest * weights[k] / weight_sum for k in keys}
    for k in keys:
        out[k] += int(shares[k])
    left = total - sum(out.values())
    for k in sorted(keys, key=lambda k: (-(shares[k] - int(shares[k])), k))[:left]:
        out[k] += 1
    return out


# --- seeds -------------------------------------------------------------------------------------


@dataclass
class Seed:
    type: str
    chunks: list[SeedChunk] = field(default_factory=list)
    hints: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "chunk_ids": [c.chunk_id for c in self.chunks],
            "sections": [c.section for c in self.chunks],
            "hints": self.hints,
        }


@dataclass
class Sampler:
    """Draws seeds for one batch; `used` keeps chunks from being reused while others remain."""

    chunks: list[SeedChunk]
    rng: random.Random
    used: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        self.chunks = sorted(
            (c for c in self.chunks if eligible(c)), key=lambda c: (c.doc_code, c.chunk_index)
        )
        self.by_doc: dict[str, list[SeedChunk]] = defaultdict(list)
        for chunk in self.chunks:
            self.by_doc[chunk.doc_code].append(chunk)

    def pick(self, pool: Sequence[SeedChunk]) -> SeedChunk | None:
        if not pool:
            return None
        fresh = [c for c in pool if c.chunk_id not in self.used]
        chunk = self.rng.choice(fresh or list(pool))
        self.used.add(chunk.chunk_id)
        return chunk

    # single-hop ---------------------------------------------------------------------------

    def single_hop(self, count: int) -> list[Seed]:
        weights = {code: len(chunks) for code, chunks in self.by_doc.items()}
        seeds = []
        for code, n in allocate(count, weights, self.rng).items():
            for _ in range(n):
                chunk = self.pick(self.by_doc[code])
                if chunk is not None:
                    seeds.append(Seed("single_hop", [chunk]))
        return seeds

    # multi-hop ----------------------------------------------------------------------------

    def cross_doc_pairs(self) -> list[tuple[SeedChunk, SeedChunk]]:
        pairs = []
        for chunk in self.chunks:
            for code in sorted(set(DOC_CODE_RE.findall(chunk.text))):
                if code == chunk.doc_code or code not in self.by_doc:
                    continue
                tokens = content_tokens(chunk.text)
                partner = max(
                    self.by_doc[code],
                    key=lambda c: (len(tokens & content_tokens(c.text)), -c.chunk_index),
                )
                pairs.append((chunk, partner))
        return pairs

    def same_doc_pair(self, code: str) -> tuple[SeedChunk, SeedChunk] | None:
        chunks = self.by_doc[code]
        first = self.pick(chunks)
        if first is None:
            return None
        others = [c for c in chunks if c.section_number != first.section_number]
        siblings = [c for c in others if c.top_section == first.top_section]
        second = self.pick(siblings or others)
        return (first, second) if second is not None else None

    def multi_hop(self, count: int) -> list[Seed]:
        seeds: list[Seed] = []
        cross = self.cross_doc_pairs()
        self.rng.shuffle(cross)
        for a, b in cross:
            if len(seeds) >= count // 2:
                break
            if a.chunk_id in self.used and b.chunk_id in self.used:
                continue
            self.used.update((a.chunk_id, b.chunk_id))
            seeds.append(Seed("multi_hop", [a, b], {"link": "cross_document"}))
        weights = {
            code: len(chunks)
            for code, chunks in self.by_doc.items()
            if len({c.section_number for c in chunks}) > 1
        }
        for code, n in allocate(count - len(seeds), weights, self.rng).items():
            for _ in range(n):
                pair = self.same_doc_pair(code)
                if pair is not None:
                    seeds.append(Seed("multi_hop", list(pair), {"link": "same_document"}))
        return seeds

    # jurisdiction & comparative -----------------------------------------------------------

    def sections(self, chunks: Iterable[SeedChunk]) -> dict[tuple[str, str], list[SeedChunk]]:
        out: dict[tuple[str, str], list[SeedChunk]] = defaultdict(list)
        for chunk in chunks:
            out[(chunk.doc_code, chunk.section_number or "")].append(chunk)
        return out

    def jurisdiction_matches(self) -> dict[str, list[tuple[list[SeedChunk], list[SeedChunk]]]]:
        """Per country: (company-wide section chunks, supplement section chunks) pairs, each
        supplement body section with its best-matching company-wide section(s) of the same
        department."""
        base = self.sections(
            c for c in self.chunks if not c.supplement and numbered(c.section_number)
        )
        local = self.sections(c for c in self.chunks if c.supplement and numbered(c.section_number))
        out: dict[str, list[tuple[list[SeedChunk], list[SeedChunk]]]] = defaultdict(list)
        pairs = best_matches(local, base, lambda head, other: other.department == head.department)
        for base_chunks, supplement_chunks in pairs:
            out[supplement_chunks[0].jurisdiction or "?"].append((base_chunks, supplement_chunks))
        return out

    def jurisdiction(self, count: int) -> list[Seed]:
        matches = self.jurisdiction_matches()
        seeds = []
        quota = allocate(count, {code: len(pairs) for code, pairs in matches.items()}, self.rng)
        for code, n in quota.items():
            pairs = list(matches[code])
            self.rng.shuffle(pairs)
            for base_chunks, local_chunks in pairs[:n]:
                a, b = self.pick(base_chunks), self.pick(local_chunks)
                if a and b:
                    seeds.append(Seed("jurisdiction", [a, b], {"jurisdiction": country(code)}))
        return seeds

    def comparative_matches(self) -> dict[tuple[str, str], list[tuple[list, list]]]:
        """Per country pair (a < b): each body section of a's supplement with its best-matching
        section(s) of b's, within one department."""
        by_country: dict[str, dict[tuple[str, str], list[SeedChunk]]] = defaultdict(dict)
        for key, chunks in self.sections(
            c for c in self.chunks if c.supplement and numbered(c.section_number)
        ).items():
            by_country[chunks[0].jurisdiction or "?"][key] = chunks
        out: dict[tuple[str, str], list[tuple[list, list]]] = defaultdict(list)
        countries = sorted(by_country)
        for i, a in enumerate(countries):
            for b in countries[i + 1 :]:
                pairs = best_matches(
                    by_country[a],
                    by_country[b],
                    lambda head, other: other.department == head.department,
                )
                out[(a, b)].extend((a_chunks, b_chunks) for b_chunks, a_chunks in pairs)
        return {key: pairs for key, pairs in out.items() if pairs}

    def comparative(self, count: int) -> list[Seed]:
        matches = self.comparative_matches()
        weights = {f"{a}|{b}": len(pairs) for (a, b), pairs in matches.items()}
        seeds = []
        for key, n in allocate(count, weights, self.rng).items():
            a_code, b_code = key.split("|")
            pairs = list(matches[(a_code, b_code)])
            self.rng.shuffle(pairs)
            for a_chunks, b_chunks in pairs[:n]:
                a, b = self.pick(a_chunks), self.pick(b_chunks)
                if a and b:
                    first, second = sorted((a, b), key=lambda c: c.jurisdiction or "")
                    hints = {
                        "jurisdiction_a": country(first.jurisdiction),
                        "jurisdiction_b": country(second.jurisdiction),
                    }
                    seeds.append(Seed("comparative", [first, second], hints))
        return seeds

    # chunkless ----------------------------------------------------------------------------

    def hinted(self, kind: str, count: int, options: Sequence[str], key: str) -> list[Seed]:
        order = list(options)
        self.rng.shuffle(order)
        return [Seed(kind, [], {key: order[i % len(order)]}) for i in range(count)]


def sample_seeds(
    chunks: Sequence[SeedChunk], type_counts: Mapping[str, int], seed: int
) -> tuple[list[Seed], dict[str, int]]:
    """Seeds for every requested type, interleaved round-robin, plus the shortfall per type
    (pools too small, e.g. no country supplements selected for `jurisdiction`)."""
    sampler = Sampler(list(chunks), random.Random(seed))
    by_type: dict[str, list[Seed]] = {}
    for kind in TYPES:
        count = int(type_counts.get(kind, 0) or 0)
        if count <= 0:
            continue
        if kind == "single_hop":
            by_type[kind] = sampler.single_hop(count)
        elif kind == "multi_hop":
            by_type[kind] = sampler.multi_hop(count)
        elif kind == "jurisdiction":
            by_type[kind] = sampler.jurisdiction(count)
        elif kind == "comparative":
            by_type[kind] = sampler.comparative(count)
        elif kind == "unanswerable":
            by_type[kind] = sampler.hinted(kind, count, ANGLES, "angle")
        else:
            by_type[kind] = sampler.hinted(kind, count, THEMES, "theme")
    shortfall = {
        kind: int(type_counts[kind]) - len(seeds)
        for kind, seeds in by_type.items()
        if len(seeds) < int(type_counts[kind])
    }
    interleaved: list[Seed] = []
    for i in range(max((len(s) for s in by_type.values()), default=0)):
        interleaved.extend(seeds[i] for seeds in by_type.values() if i < len(seeds))
    return interleaved, shortfall


def catalog(chunks: Sequence[SeedChunk], documents: Sequence[Document]) -> list[dict[str, Any]]:
    """Every document with its section titles (numbered sections, in order) for the chunkless
    prompts; built from all chunks, eligible or not."""
    sections: dict[str, dict[str, str]] = defaultdict(dict)
    for chunk in sorted(chunks, key=lambda c: (c.doc_code, c.chunk_index)):
        if chunk.section_number and chunk.section_title:
            sections[chunk.doc_code].setdefault(chunk.section_number, chunk.section_title)
    return [
        {
            "doc_code": doc.doc_code,
            "title": doc.title,
            "department": doc.department,
            "jurisdiction": doc.jurisdiction if doc.doc_type == SUPPLEMENT else None,
            "sections": [[n, t] for n, t in sections.get(doc.doc_code or "", {}).items()],
        }
        for doc in sorted(documents, key=lambda d: d.doc_code or "")
        if doc.doc_code
    ]


# --- DocuMind reads ----------------------------------------------------------------------------


async def fetch_chunks(
    client: DocuMindClient, org_id: str, documents: Sequence[Document]
) -> list[SeedChunk]:
    """Every chunk of the documents (paged by 500), `CHUNK_FETCH_CONCURRENCY` at a time. These
    are plain DB reads on DocuMind (no LLM), so they don't take the shared DocuMind limiter
    (sized for chats): with 2 slots a 14-document org took ~30 s to sample."""
    gate = asyncio.Semaphore(CHUNK_FETCH_CONCURRENCY)

    async def one(doc: Document) -> list[SeedChunk]:
        out: list[SeedChunk] = []
        offset = 0
        while True:
            async with gate:
                page = await client.chunks(org_id, doc.id, offset=offset, limit=500)
            out.extend(chunks_from_page(page.document, page.chunks))
            offset += len(page.chunks)
            if not page.chunks or offset >= page.total:
                return out

    pages = await asyncio.gather(*(one(doc) for doc in documents))
    return [chunk for page in pages for chunk in page]


async def org_by_slug(client: DocuMindClient, slug: str) -> Any:
    org = next((o for o in (await client.me()).orgs if o.slug == slug), None)
    if org is None:
        raise ApiError(404, "org_not_found", f"The eval service account can't see org {slug!r}.")
    return org


# --- batch creation ----------------------------------------------------------------------------


@dataclass(frozen=True)
class NewCandidate:
    type: str
    seed: dict[str, Any]
    source_excerpt: list[dict[str, Any]]
    question: str | None = None
    fields: dict[str, Any] = field(default_factory=dict)


def candidates_from_seeds(seeds: Sequence[Seed]) -> list[NewCandidate]:
    return [
        NewCandidate(
            type=s.type,
            seed=s.as_dict(),
            source_excerpt=[c.excerpt(n) for n, c in enumerate(s.chunks, start=1)],
        )
        for s in seeds
    ]


def enrichment_candidates(
    cases: Sequence[Case], chunks: Sequence[SeedChunk], *, only_missing: bool, max_chunks: int = 8
) -> tuple[list[NewCandidate], list[dict[str, str]]]:
    """One candidate per case that expects documents: its excerpt = the chunks of its expected
    sections (in document order, capped); a case with codes but no sections retrieves at
    generation time (`seed.retrieve`)."""
    by_section: dict[str, list[SeedChunk]] = defaultdict(list)
    for chunk in sorted(chunks, key=lambda c: (c.doc_code, c.chunk_index)):
        if chunk.section_number and chunk.content_type not in EXCLUDED_CONTENT:
            by_section[chunk.section].append(chunk)
    out: list[NewCandidate] = []
    skipped: list[dict[str, str]] = []
    for case in cases:
        if only_missing and (case.reference_answer or "").strip() and case.key_facts:
            skipped.append({"case_key": case.case_key, "reason": "has_reference"})
            continue
        if not case.expected_doc_codes:
            skipped.append({"case_key": case.case_key, "reason": "no_expected_documents"})
            continue
        picked = [c for s in case.expected_sections for c in by_section.get(s, [])][:max_chunks]
        out.append(
            NewCandidate(
                type=case.type,
                seed={
                    "sections": list(case.expected_sections),
                    "doc_codes": list(case.expected_doc_codes),
                    "retrieve": not case.expected_sections,
                    "missing_sections": [s for s in case.expected_sections if s not in by_section],
                },
                source_excerpt=[c.excerpt(n) for n, c in enumerate(picked, start=1)],
                question=case.question,
                fields={
                    "target_case_key": case.case_key,
                    "setup_turns": list(case.setup_turns or []),
                    "expected_doc_codes": list(case.expected_doc_codes),
                    "expected_sections": list(case.expected_sections),
                    "expected_pages": case.expected_pages,
                    "expected_departments": list(case.expected_departments or []),
                    "expected_jurisdiction": case.expected_jurisdiction,
                    "expected_behavior": case.expected_behavior,
                    "reference_answer": case.reference_answer,
                    "key_facts": list(case.key_facts or []),
                },
            )
        )
    return out, skipped


INSERT_JOBS_SQL = text(
    """
    INSERT INTO jobs (id, kind, batch_id, payload, max_attempts, created_at)
    VALUES (:id, 'synthetic_generate', :batch_id, CAST(:payload AS jsonb), 3, clock_timestamp())
    """
)


async def insert_batch(
    session: AsyncSession, batch: SyntheticBatch, candidates: Sequence[NewCandidate]
) -> None:
    """The batch, its candidates (ordinals 1…n) and one job per candidate, in dataset order."""
    if not candidates:
        raise ApiError(422, "no_candidates", "Nothing to generate: no seeds could be sampled.")
    batch.candidate_count = len(candidates)
    session.add(batch)
    await session.flush()
    rows = [
        SyntheticCandidate(
            id=uuid.uuid4(),
            batch_id=batch.id,
            ordinal=ordinal,
            type=c.type,
            seed=c.seed,
            source_excerpt=c.source_excerpt,
            source_chunk_ids=[e["chunk_id"] for e in c.source_excerpt],
            question=c.question,
            **{"expected_behavior": "refuse" if c.type in REFUSING_TYPES else "answer", **c.fields},
        )
        for ordinal, c in enumerate(candidates, start=1)
    ]
    session.add_all(rows)
    await session.flush()
    await session.execute(
        INSERT_JOBS_SQL,
        [
            {"id": uuid.uuid4(), "batch_id": batch.id, "payload": f'{{"candidate_id": "{r.id}"}}'}
            for r in rows
        ],
    )


def estimate(kind: str, count: int) -> Decimal:
    return COST_PER_CANDIDATE[kind] * count


async def generator_refs(session: AsyncSession) -> dict[str, Any]:
    return await registry.sync(session, kind="generator")


async def get_batch_or_404(
    session: AsyncSession, batch_id: uuid.UUID, *, for_update: bool = False
) -> SyntheticBatch:
    stmt = select(SyntheticBatch).where(SyntheticBatch.id == batch_id)
    if for_update:
        stmt = stmt.with_for_update()
    batch = (await session.execute(stmt)).scalar_one_or_none()
    if batch is None:
        raise ApiError(404, "not_found", "Synthetic batch not found.")
    return batch


async def latest_version(session: AsyncSession, dataset_id: uuid.UUID) -> DatasetVersion | None:
    versions = await dataset_service.versions_of(session, dataset_id)
    return versions[0] if versions else None


async def dataset_questions(
    session: AsyncSession, dataset_id: uuid.UUID | None
) -> list[tuple[str, str]]:
    """`(case_key, question)` of the dataset's latest version (the dedupe reference)."""
    if dataset_id is None:
        return []
    version = await latest_version(session, dataset_id)
    if version is None:
        return []
    rows = await session.execute(
        select(Case.case_key, Case.question).where(Case.dataset_version_id == version.id)
    )
    return [(key, question) for key, question in rows.all()]


# --- reads -------------------------------------------------------------------------------------


COMMITTED = sql_case((SyntheticCandidate.case_id.is_not(None), 1), else_=0)


async def candidate_counts(
    session: AsyncSession, batch_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    """Per batch: review counts overall and per type (generated candidates only, plus queued)."""
    if not batch_ids:
        return {}
    rows = (
        await session.execute(
            select(
                SyntheticCandidate.batch_id,
                SyntheticCandidate.type,
                SyntheticCandidate.gen_status,
                SyntheticCandidate.status,
                SyntheticCandidate.auto_rejected,
                func.sum(COMMITTED),
                func.count(),
            )
            .where(SyntheticCandidate.batch_id.in_(batch_ids))
            .group_by(
                SyntheticCandidate.batch_id,
                SyntheticCandidate.type,
                SyntheticCandidate.gen_status,
                SyntheticCandidate.status,
                SyntheticCandidate.auto_rejected,
            )
        )
    ).all()
    out: dict[uuid.UUID, dict[str, Any]] = {}
    for batch_id, kind, gen_status, status, auto, committed, count in rows:
        entry = out.setdefault(batch_id, {"counts": Counter(), "by_type": {}})
        per_type = entry["by_type"].setdefault(kind, Counter())
        for bucket in (entry["counts"], per_type):
            bucket["total"] += count
            if gen_status == "queued":
                bucket["queued"] += count
                continue
            bucket[status] += count
            if auto:
                bucket["auto_rejected"] += count
            bucket["committed"] += int(committed or 0)
    return out


async def list_batches(
    session: AsyncSession, *, kind: str | None = None, status: str | None = None
) -> list[SyntheticBatch]:
    stmt = select(SyntheticBatch).order_by(SyntheticBatch.created_at.desc())
    if kind:
        stmt = stmt.where(SyntheticBatch.kind == kind)
    if status:
        stmt = stmt.where(SyntheticBatch.status == status)
    return list((await session.execute(stmt)).scalars())


async def datasets_by_id(
    session: AsyncSession, ids: Iterable[uuid.UUID | None]
) -> dict[uuid.UUID, Dataset]:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = await session.execute(select(Dataset).where(Dataset.id.in_(wanted)))
    return {d.id: d for d in rows.scalars()}


async def list_candidates(
    session: AsyncSession,
    batch_id: uuid.UUID,
    *,
    status: str | None = None,
    type: str | None = None,
) -> list[SyntheticCandidate]:
    stmt = (
        select(SyntheticCandidate)
        .where(SyntheticCandidate.batch_id == batch_id)
        .order_by(SyntheticCandidate.ordinal)
    )
    if status == "queued":
        stmt = stmt.where(SyntheticCandidate.gen_status == "queued")
    elif status:
        stmt = stmt.where(
            SyntheticCandidate.status == status, SyntheticCandidate.gen_status != "queued"
        )
    if type:
        stmt = stmt.where(SyntheticCandidate.type == type)
    return list((await session.execute(stmt)).scalars())


def lock_key(batch_id: uuid.UUID) -> int:
    """A signed 64-bit advisory-lock key for one batch."""
    return int.from_bytes(batch_id.bytes[:8], "big", signed=True) ^ LOCK_SALT


# --- create / resume / delete ------------------------------------------------------------------


async def create_batch(
    session: AsyncSession, body: BatchIn, client: DocuMindClient, created_by: str | None
) -> SyntheticBatch:
    """Sample (or, for enrichment, collect) the seeds, record the generator prompt versions and
    insert the batch with its candidates and jobs, in the caller's transaction."""
    target: Dataset | None = None
    source: DatasetVersion | None = None
    if body.kind == "enrichment":
        assert body.dataset_version_id is not None  # BatchIn checks it
        source = await dataset_service.get_version_or_404(session, body.dataset_version_id)
        target = await dataset_service.get_dataset_or_404(session, source.dataset_id)
    elif body.target_dataset_id is not None:
        target = await dataset_service.get_dataset_or_404(session, body.target_dataset_id)
    org_slug = body.org_slug or (target.default_org_slug if target else None)
    if not org_slug:
        raise ApiError(422, "org_required", "Pick an org (or a target dataset with a default org).")
    org = await org_by_slug(client, org_slug)
    documents = [d for d in await client.documents(org.id) if d.status in (None, "ready")]
    if body.document_ids:
        unknown = sorted(set(body.document_ids) - {d.id for d in documents})
        if unknown:
            raise ApiError(422, "unknown_documents", "Some documents aren't ready in this org.",
                           {"document_ids": unknown})  # fmt: skip
    seed = body.seed if body.seed is not None else random.SystemRandom().randrange(2**31)
    config: dict[str, Any] = {
        "generator_model": body.generator_model,
        "validator_model": body.validator_model,
        "seed": seed,
    }
    if offline.enabled():
        config["judge_mode"] = "offline"  # answered by Claude Code, not the API models

    if body.kind == "enrichment":
        assert source is not None
        cases = await dataset_service.cases_of(session, source.id)
        codes = {code for c in cases for code in c.expected_doc_codes}
        docs = [d for d in documents if d.doc_code in codes]
        chunks = await fetch_chunks(client, org.id, docs)
        new, skipped = enrichment_candidates(cases, chunks, only_missing=body.only_missing)
        config.update(
            {
                "dataset_version": source.version,
                "only_missing": body.only_missing,
                "skipped": skipped,
                "doc_ids": {d.doc_code: d.id for d in docs},
            }
        )
    else:
        selected = [d for d in documents if not body.document_ids or d.id in body.document_ids]
        all_chunks = await fetch_chunks(client, org.id, documents)
        chosen_ids = {d.id for d in selected}
        chunks = [c for c in all_chunks if c.document_id in chosen_ids]
        seeds, shortfall = sample_seeds(chunks, body.type_counts, seed)
        new = candidates_from_seeds(seeds)
        config.update(
            {
                "document_ids": sorted(chosen_ids),
                "doc_codes": sorted({d.doc_code for d in selected if d.doc_code}),
                "type_counts": dict(body.type_counts),
                "shortfall": shortfall,
                "eligible_chunks": sum(1 for c in chunks if eligible(c)),
                # The chunkless prompts see what the whole org covers, not just the selection.
                "catalog": catalog(all_chunks, documents),
            }
        )
    cap = body.max_cost_usd or estimate(body.kind, len(new)) * DEFAULT_CAP_FACTOR
    batch = SyntheticBatch(
        id=uuid.uuid4(),
        name=body.name,
        org_id=org.id,
        org_slug=org.slug,
        target_dataset_id=target.id if target else None,
        source_version_id=source.id if source else None,
        kind=body.kind,
        config=config,
        status="generating",
        prompt_version_ids=await generator_refs(session),
        max_cost_usd=cap,
        created_by=created_by,
    )
    await insert_batch(session, batch, new)
    return batch


async def resume_batch(
    session: AsyncSession, batch_id: uuid.UUID, max_cost_usd: Decimal | None
) -> SyntheticBatch:
    batch = await get_batch_or_404(session, batch_id, for_update=True)
    if batch.status != "paused":
        raise ApiError(409, "not_paused", f"The batch is {batch.status}, not paused.")
    if max_cost_usd is not None:
        batch.max_cost_usd = max_cost_usd
    if batch.max_cost_usd is not None and batch.cost_usd >= batch.max_cost_usd:
        raise ApiError(
            409,
            "budget_exhausted",
            "The batch has spent its cap; resume with a higher max_cost_usd.",
            {"cost_usd": str(batch.cost_usd), "max_cost_usd": str(batch.max_cost_usd)},
        )
    batch.status, batch.status_reason = "generating", None
    await session.flush()
    return batch


async def delete_batch(session: AsyncSession, batch_id: uuid.UUID) -> None:
    """Candidates and jobs go with it; judge calls keep their cost (batch id set to NULL).
    Cases already committed stay in their dataset."""
    batch = await get_batch_or_404(session, batch_id, for_update=True)
    running = await session.scalar(
        text("SELECT count(*) FROM jobs WHERE batch_id = :b AND status = 'running'"),
        {"b": batch.id},
    )
    if running:
        raise ApiError(409, "batch_busy", "Candidates are being generated; pause it or wait.")
    await session.delete(batch)
    await session.flush()
