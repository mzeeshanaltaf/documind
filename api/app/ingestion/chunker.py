"""Parsed blocks → heading-aware chunks with section metadata, ready to embed and index.

- A heading stack gives each block its `section_path`; `section_number` is the nearest numbered
  heading in that path (`3.1`, `5`, or an appendix letter; "Part N" headings don't count).
- Chunks never cross a change of section (number + level-1/2 path). Level-3 subheadings inside a
  section merge. Target 600 tokens, hard max 800; oversized sections split at block, then
  sentence boundaries, carrying ~90 tokens of overlap into the next chunk.
- Tables are standalone chunks prefixed by their nearest heading (split by rows, header repeated).
"""

import re
from dataclasses import dataclass, field
from functools import lru_cache

import tiktoken

from app.ingestion.header import find_doc_codes
from app.ingestion.parser import Block, ParsedDocument, split_heading

TARGET_TOKENS = 600
MAX_TOKENS = 800
OVERLAP_TOKENS = 90
MIN_TOKENS = 40  # smaller pieces of a section are folded into a neighbouring chunk

SECTION_NUMBER_RE = re.compile(r"^(?:\d+(?:\.\d+)*|[A-Z])$")
SECTION_REF_RES = (
    re.compile(r"\((\d+\.\d+)\)"),
    re.compile(r"(?:section|§)\s*(\d+\.\d+)", re.IGNORECASE),
)
SENTENCE_RE = re.compile(r"(?<=[.!?;])\s+(?=[A-Z0-9(\"“])")
APPENDIX_RE = re.compile(r"\bappendi(?:x|ces)\b", re.IGNORECASE)
GLOSSARY_RE = re.compile(r"\b(?:glossary|definitions|defined terms|abbreviations)\b", re.IGNORECASE)
REVISION_RE = re.compile(
    r"\b(?:revision|version|document|change) (?:history|log)\b|\bchangelog\b", re.IGNORECASE
)


@lru_cache
def _encoding() -> tiktoken.Encoding:
    return tiktoken.get_encoding("o200k_base")


def count_tokens(text: str) -> int:
    return len(_encoding().encode(text, disallowed_special=()))


def _piece_tokens(text: str) -> int:
    return count_tokens(text) + 1  # + the "\n\n" that joins pieces


@dataclass(frozen=True)
class EmbedContext:
    """Document fields that go into each chunk's contextual header."""

    doc_code: str | None
    title: str | None
    version: str | None
    jurisdiction: str | None
    department: str | None


@dataclass
class ChunkDraft:
    chunk_index: int
    text: str
    embed_text: str
    section_path: list[str]
    section_number: str | None
    section_title: str | None
    page_start: int
    page_end: int
    content_type: str
    token_count: int
    cross_refs: list[str]


@dataclass
class _Piece:
    kind: str  # heading | paragraph | list | table | overlap
    text: str
    page: int
    path: tuple[str, ...]
    tokens: int


@dataclass
class _Group:
    number: str | None
    title: str | None
    pieces: list[_Piece] = field(default_factory=list)


def embed_header(ctx: EmbedContext, section_path: list[str]) -> str:
    doc = " · ".join(
        part
        for part in (
            ctx.doc_code,
            f"{ctx.title} v{ctx.version}" if ctx.title and ctx.version else ctx.title,
            ctx.jurisdiction,
            ctx.department,
        )
        if part
    )
    path = " › ".join(section_path)
    return f"[{doc} | {path}]" if path else f"[{doc}]"


def build_embed_text(ctx: EmbedContext, section_path: list[str], text: str) -> str:
    return f"{embed_header(ctx, section_path)}\n{text}"


def find_cross_refs(text: str, own_code: str | None = None) -> list[str]:
    refs = [code for code in find_doc_codes(text) if code != own_code]
    for pattern in SECTION_REF_RES:
        refs.extend(pattern.findall(text))
    return list(dict.fromkeys(refs))


# --- grouping --------------------------------------------------------------------------------


def _section_of(stack: list[tuple[int, str]]) -> tuple[str | None, str | None]:
    """Nearest numbered heading in the path → (number, title without the number)."""
    for _, text in reversed(stack):
        number, title = split_heading(text)
        if number and SECTION_NUMBER_RE.match(number):
            return number, title
    if stack:
        return None, split_heading(stack[-1][1])[1]
    return None, None


def _groups(blocks: list[Block], title_lines: list[str]) -> list[_Group]:
    groups: list[_Group] = []
    stack: list[tuple[int, str]] = []
    current_key: tuple | None = None
    for block in blocks:
        if block.kind == "heading" and block.page == 1 and block.text in title_lines:
            continue  # the document title is already in every chunk's contextual header
        if block.kind == "heading":
            level = block.level or 3
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, block.text))
        number, title = _section_of(stack)
        key = (number, tuple(text for level, text in stack if level <= 2))
        if key != current_key:
            groups.append(_Group(number, title))
            current_key = key
        path = tuple(text for _, text in stack)
        groups[-1].pieces.append(
            _Piece(block.kind, block.text, block.page, path, _piece_tokens(block.text))
        )
    # A section made only of headings (e.g. "Part 3 – …" right before "3.1 …") has no content.
    return [g for g in groups if any(p.kind != "heading" for p in g.pieces)]


# --- splitting oversized pieces --------------------------------------------------------------


def _hard_split(text: str, limit: int) -> list[str]:
    tokens = _encoding().encode(text, disallowed_special=())
    return [_encoding().decode(tokens[i : i + limit]) for i in range(0, len(tokens), limit)]


def _split_piece(piece: _Piece, limit: int) -> list[_Piece]:
    """Split a paragraph/list longer than `limit` at item or sentence boundaries."""
    if piece.tokens <= limit:
        return [piece]
    units = piece.text.split("\n") if piece.kind == "list" else SENTENCE_RE.split(piece.text)
    joiner = "\n" if piece.kind == "list" else " "
    parts: list[str] = []
    current: list[str] = []
    for unit in units:
        if count_tokens(unit) > limit:
            if current:
                parts.append(joiner.join(current))
                current = []
            parts.extend(_hard_split(unit, limit))
            continue
        candidate = joiner.join([*current, unit])
        if current and count_tokens(candidate) > limit:
            parts.append(joiner.join(current))
            current = [unit]
        else:
            current.append(unit)
    if current:
        parts.append(joiner.join(current))
    return [_Piece(piece.kind, part, piece.page, piece.path, _piece_tokens(part)) for part in parts]


def _overlap(pieces: list[_Piece]) -> _Piece | None:
    """The last ~90 tokens of a chunk's content, starting at a sentence (or word) boundary."""
    content = [p for p in pieces if p.kind in ("paragraph", "list", "overlap")]
    if not content:
        return None
    last = content[-1]
    sentences = SENTENCE_RE.split(last.text.replace("\n", " "))
    tail: list[str] = []
    for sentence in reversed(sentences):
        candidate = " ".join([sentence, *tail])
        if count_tokens(candidate) > OVERLAP_TOKENS * 1.4:
            break
        tail.insert(0, sentence)
        if count_tokens(candidate) >= OVERLAP_TOKENS * 0.6:
            break
    if not tail:
        tokens = _encoding().encode(last.text, disallowed_special=())
        text = _encoding().decode(tokens[-OVERLAP_TOKENS:])
        text = text.split(" ", 1)[1] if " " in text else text
    else:
        text = " ".join(tail)
    if text == last.text:
        return None  # the whole last block would repeat; not an overlap
    return _Piece("overlap", f"… {text}", last.page, last.path, _piece_tokens(f"… {text}"))


# --- chunk assembly --------------------------------------------------------------------------


def _common_prefix(paths: list[tuple[str, ...]]) -> list[str]:
    prefix: list[str] = []
    for parts in zip(*paths, strict=False):
        if len(set(parts)) != 1:
            break
        prefix.append(parts[0])
    return prefix


def _content_type(pieces: list[_Piece], path: list[str]) -> str:
    joined = " ".join(path)
    if REVISION_RE.search(joined):
        return "revision_history"
    if GLOSSARY_RE.search(joined):
        return "glossary"
    body = [p for p in pieces if p.kind in ("paragraph", "list", "table")]
    total = sum(p.tokens for p in body) or 1
    for kind in ("table", "list"):
        if sum(p.tokens for p in body if p.kind == kind) / total > 0.5:
            return kind
    if APPENDIX_RE.search(joined):
        return "appendix"
    return "prose"


def _table_chunks(piece: _Piece, prefix: str) -> list[str]:
    """A table as one chunk, or split by rows with the header repeated."""
    head = f"{prefix}\n\n" if prefix else ""
    whole = head + piece.text
    if count_tokens(whole) <= MAX_TOKENS:
        return [whole]
    lines = piece.text.split("\n")
    header, rows = lines[:2], lines[2:]
    base = count_tokens(head + "\n".join(header)) + 1
    parts: list[list[str]] = []
    current: list[str] = []
    used = base
    for row in rows:
        row_tokens = count_tokens(row) + 1
        if current and used + row_tokens > MAX_TOKENS:
            parts.append(current)
            current, used = [], base
        if base + row_tokens > MAX_TOKENS:  # one giant row: hard split it
            parts.extend([[fragment] for fragment in _hard_split(row, MAX_TOKENS - base)])
            continue
        current.append(row)
        used += row_tokens
    if current:
        parts.append(current)
    return [head + "\n".join([*header, *part]) for part in parts]


def _pack(group: _Group) -> list[tuple[list[_Piece], str | None]]:
    """Group pieces → chunk piece lists. Tables come out alone as (pieces, prefix)."""
    chunks: list[tuple[list[_Piece], str | None]] = []
    current: list[_Piece] = []
    tokens = 0

    def flush(*, with_overlap: bool) -> None:
        nonlocal current, tokens
        pending: list[_Piece] = []
        while current and current[-1].kind == "heading":  # a heading belongs with what follows
            pending.insert(0, current.pop())
        if any(p.kind not in ("heading", "overlap") for p in current):
            chunks.append((current, None))
            overlap = _overlap(current) if with_overlap else None
        else:
            pending = current + pending
            overlap = None
        current = ([overlap] if overlap else []) + pending
        tokens = sum(p.tokens for p in current)

    for piece in group.pieces:
        if piece.kind == "table":
            flush(with_overlap=False)
            headings = [p.text for p in current if p.kind == "heading"]
            prefix = "\n".join(headings) if headings else (piece.path[-1] if piece.path else "")
            chunks.append(([piece], prefix))
            current, tokens = [], 0
            continue
        for part in _split_piece(piece, MAX_TOKENS - OVERLAP_TOKENS - 20):
            if current and tokens + part.tokens > TARGET_TOKENS:
                has_body = any(p.kind not in ("heading", "overlap") for p in current)
                if has_body and (tokens >= TARGET_TOKENS // 2 or tokens + part.tokens > MAX_TOKENS):
                    flush(with_overlap=True)
                    if tokens + part.tokens > MAX_TOKENS:
                        current = [p for p in current if p.kind != "overlap"]
                        tokens = sum(p.tokens for p in current)
            current.append(part)
            tokens += part.tokens
    if any(p.kind not in ("heading", "overlap") for p in current):
        chunks.append((current, None))
    return chunks


@dataclass
class _Draft:
    text: str
    path: list[str]
    pages: list[int]
    content_type: str
    tokens: int


def _merge_small(drafts: list[_Draft]) -> list[_Draft]:
    """Fold remnants (e.g. "Employee comments:" after a form table) into a neighbour from the
    same section: the previous chunk if it has room, else the next one."""
    merged: list[_Draft] = []
    pending: _Draft | None = None  # a small leading draft waiting for the next one
    for draft in drafts:
        if pending:
            if pending.tokens + draft.tokens <= MAX_TOKENS:
                draft = _Draft(
                    f"{pending.text}\n\n{draft.text}",
                    _common_prefix([tuple(pending.path), tuple(draft.path)]),
                    pending.pages + draft.pages,
                    draft.content_type,
                    pending.tokens + draft.tokens,
                )
            else:
                merged.append(pending)
            pending = None
        if draft.tokens < MIN_TOKENS:
            prev = merged[-1] if merged else None
            if prev and prev.tokens + draft.tokens <= MAX_TOKENS:
                prev.text = f"{prev.text}\n\n{draft.text}"
                prev.path = _common_prefix([tuple(prev.path), tuple(draft.path)])
                prev.pages += draft.pages
                prev.tokens += draft.tokens
                continue
            if not merged:
                pending = draft
                continue
        merged.append(draft)
    if pending:
        merged.append(pending)
    return merged


def chunk_document(parsed: ParsedDocument, ctx: EmbedContext) -> list[ChunkDraft]:
    chunks: list[ChunkDraft] = []
    for group in _groups(parsed.blocks, parsed.title_lines):
        drafts: list[_Draft] = []
        for pieces, table_prefix in _pack(group):
            if table_prefix is not None:
                texts = _table_chunks(pieces[0], table_prefix)
            else:
                texts = ["\n\n".join(p.text for p in pieces)]
            path = _common_prefix([p.path for p in pieces])
            content_type = _content_type(pieces, path)
            pages = [p.page for p in pieces]
            drafts.extend(
                _Draft(text, path, pages, content_type, _piece_tokens(text)) for text in texts
            )
        for draft in _merge_small(drafts):
            chunks.append(
                ChunkDraft(
                    chunk_index=len(chunks),
                    text=draft.text,
                    embed_text=build_embed_text(ctx, draft.path, draft.text),
                    section_path=draft.path,
                    section_number=group.number,
                    section_title=group.title,
                    page_start=min(draft.pages),
                    page_end=max(draft.pages),
                    content_type=draft.content_type,
                    token_count=count_tokens(draft.text),
                    cross_refs=find_cross_refs(draft.text, ctx.doc_code),
                )
            )
    return chunks
