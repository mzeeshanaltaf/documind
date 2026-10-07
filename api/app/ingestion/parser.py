"""PDF → structured blocks (headings, paragraphs, lists, tables) with pdfplumber.

Heuristics (calibrated on the Simtora manuals, which render body text at 12pt and headings at
24/18/15pt semibold):
- body size = the most common line size; heading levels rank the larger sizes (1 = largest);
  a fully-bold, short, body-size line without closing punctuation is a level-3 heading.
- tables come from `find_tables()`; a page-sized frame "table" is ignored, and words inside
  real tables are removed from the prose.
- the "Page N of M" footer and rule-only lines are dropped; a table of contents is skipped.
"""

import io
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import pdfplumber

from app.ingestion.header import clean_cell, is_header_table, parse_header_rows

BlockKind = Literal["heading", "paragraph", "list", "table"]

FOOTER_RE = re.compile(r"^(?:Page \d+ of \d+|End of document\b.*)$", re.IGNORECASE)
RULE_RE = re.compile(r"^[\s\-_=—–·.•*]+$")
LIST_MARKER_RE = re.compile(
    r"^(?:[•●▪◦‣∙–\-*∗]\s+|\d{1,2}[.)]\s+|\((?:[a-z]|[ivx]{1,4}|\d{1,2})\)\s+)"
)
TOC_RE = re.compile(r"^(?:table of )?contents$", re.IGNORECASE)
BOLD_RE = re.compile(r"bold|semibold|demi|black|heavy", re.IGNORECASE)
WORD_RE = re.compile(r"[A-Za-z]+")
# Font switches (bold → regular) split words, leaving "days )." or "completion :".
SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([).,;:!?](?:\s|$))")
# Heading numbers: "3.1 Open Door…", "1. Simtora at a Glance", "Part 3 – …", "Appendix A – …".
PART_RE = re.compile(r"^Part\s+(\d+|[IVX]+)\b\s*[–—:.-]?\s*(.*)$", re.IGNORECASE)
APPENDIX_RE = re.compile(r"^(Appendix|Annex|Schedule)\s+([A-Z0-9]{1,3})\b\s*[–—:.-]?\s*(.*)$")
NUMBERED_RE = re.compile(r"^(\d{1,3}(?:\.\d{1,3})*)\.?\s+(\S.*)$")
LETTERED_RE = re.compile(r"^([A-Z])\.\s+(\S.*)$")

LEVEL3_MAX_CHARS = 90
FRAME_COVERAGE = 0.9  # a "table" covering ≥ 90% of the page is the page frame, not a table


@dataclass
class Block:
    kind: BlockKind
    level: int | None
    text: str
    page: int


@dataclass
class ParsedDocument:
    pages: int
    header: dict[str, Any]
    title_lines: list[str]
    blocks: list[Block]
    outline: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class _Line:
    text: str
    page: int
    top: float
    bottom: float
    x0: float
    x1: float
    size: float
    bold: bool


@dataclass
class _Table:
    page: int
    top: float
    rows: list[list[str]]
    is_header: bool


def split_heading(text: str) -> tuple[str | None, str]:
    """Heading text → (number, title). Part headings yield "Part N"; appendices their letter."""
    if match := PART_RE.match(text):
        return f"Part {match.group(1)}", match.group(2).strip() or text
    if match := APPENDIX_RE.match(text):
        return match.group(2), match.group(3).strip() or text
    if match := NUMBERED_RE.match(text):
        return match.group(1), match.group(2).strip()
    if match := LETTERED_RE.match(text):
        return match.group(1), match.group(2).strip()
    return None, text


# --- page extraction -------------------------------------------------------------------------


def _is_bold(fontname: str) -> bool:
    return bool(BOLD_RE.search(fontname.split("+")[-1]))


def _real_tables(page: Any) -> list[Any]:
    tables = []
    for table in page.find_tables():
        x0, top, x1, bottom = table.bbox
        if (x1 - x0) >= page.width * FRAME_COVERAGE and (bottom - top) >= page.height * 0.8:
            continue
        tables.append(table)
    return tables


def _inside(word: dict[str, Any], bboxes: list[tuple[float, float, float, float]]) -> bool:
    cx, cy = (word["x0"] + word["x1"]) / 2, (word["top"] + word["bottom"]) / 2
    return any(x0 <= cx <= x1 and top <= cy <= bottom for x0, top, x1, bottom in bboxes)


def _group_lines(words: list[dict[str, Any]], page_no: int) -> list[_Line]:
    """Cluster words into visual lines by `top` (tolerating superscripts), left to right."""
    lines: list[list[dict[str, Any]]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and word["top"] - lines[-1][0]["top"] <= max(2.0, 0.35 * word["size"]):
            lines[-1].append(word)
        else:
            lines.append([word])

    result = []
    for line_words in lines:
        line_words.sort(key=lambda w: w["x0"])
        sizes: Counter[float] = Counter()
        for w in line_words:
            # Half-point precision keeps 14.5pt KaTeX math apart from 15pt headings.
            sizes[round(w["size"] * 2) / 2] += len(w["text"])
        text_words = [w for w in line_words if WORD_RE.search(w["text"])] or line_words
        result.append(
            _Line(
                text=SPACE_BEFORE_PUNCT_RE.sub(r"\1", " ".join(w["text"] for w in line_words)),
                page=page_no,
                top=min(w["top"] for w in line_words),
                bottom=max(w["bottom"] for w in line_words),
                x0=line_words[0]["x0"],
                x1=max(w["x1"] for w in line_words),
                size=sizes.most_common(1)[0][0],
                bold=all(_is_bold(w["fontname"]) for w in text_words),
            )
        )
    return result


def _clean_rows(raw_rows: list[list[str | None]]) -> list[list[str]]:
    rows = [[clean_cell(cell) for cell in row] for row in raw_rows]
    rows = [row for row in rows if any(row)]
    if not rows:
        return []
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    keep = [i for i in range(width) if any(row[i] for row in rows)]
    return [[row[i] for i in keep] for row in rows]


def _extract_page(page: Any, page_no: int) -> tuple[list[_Line], list[_Table]]:
    tables = []
    bboxes = []
    for table in _real_tables(page):
        raw = table.extract()
        rows = _clean_rows(raw)
        bboxes.append(table.bbox)  # its words never join the prose, even if it's unusable
        if len(rows) >= 1 and len(rows[0]) >= 2:
            tables.append(_Table(page_no, table.bbox[1], rows, is_header_table(raw)))
    words = page.extract_words(
        extra_attrs=["size", "fontname"], keep_blank_chars=False, use_text_flow=True
    )
    words = [w for w in words if not _inside(w, bboxes)]
    lines = [
        line
        for line in _group_lines(words, page_no)
        if not FOOTER_RE.match(line.text) and not RULE_RE.match(line.text)
    ]
    return lines, tables


# --- line classification ---------------------------------------------------------------------


def _heading_levels(lines: list[_Line], body: float) -> dict[float, int]:
    """Sizes larger than body that carry headings (bold, or clearly larger) → level 1..3."""
    sizes = {
        line.size
        for line in lines
        if line.size > body and (line.bold or line.size >= body * 1.3) and len(line.text) < 160
    }
    return {size: min(rank, 3) for rank, size in enumerate(sorted(sizes, reverse=True), start=1)}


def _heading_level(
    line: _Line, prev: _Line | None, body: float, levels: dict[float, int], right_edge: float
) -> int | None:
    if line.size in levels and (line.bold or line.size >= body * 1.3):
        return levels[line.size]
    # A bold body-size line is a level-3 heading only if it stands apart: a paragraph gap above
    # (or first on the page), a short line, no closing punctuation. Wrapped bold sentences fail.
    stands_apart = prev is None or line.top - prev.bottom > body * 0.9
    short = line.x1 < right_edge - 0.15 * (right_edge - line.x0)
    if (
        line.size == body
        and line.bold
        and stands_apart
        and short
        and len(line.text) <= LEVEL3_MAX_CHARS
        and not line.text.rstrip().endswith((".", ",", ";", ":"))
        and not LIST_MARKER_RE.match(line.text)
        and WORD_RE.search(line.text)
    ):
        return 3
    return None


def _join(prev: str, nxt: str, vocabulary: set[str]) -> str:
    """Join wrapped lines. A trailing hyphen joins without a space; it is dropped only when the
    joined word appears unhyphenated elsewhere in the document (a real soft hyphenation)."""
    if prev.endswith("-") and len(prev) > 1 and prev[-2].isalnum():
        head = re.search(r"([A-Za-z]+)-$", prev)
        tail = re.match(r"([a-z]+)", nxt)
        if head and tail and (head.group(1) + tail.group(1)).lower() in vocabulary:
            return prev[:-1] + nxt
        return prev + nxt
    return f"{prev} {nxt}"


# --- block assembly --------------------------------------------------------------------------


@dataclass
class _Builder:
    body: float
    levels: dict[float, int]
    vocabulary: set[str]
    right_edge: float
    blocks: list[Block] = field(default_factory=list)
    # The open block being extended, its last line, and (for lists) the item marker's x0.
    _open: Block | None = None
    _last: _Line | None = None
    _item_x0: float = 0.0
    _prev_line: _Line | None = None  # previous line on this page (any block)
    _carry: Block | None = None  # a level-1/2 heading that ended the previous page

    def close(self) -> None:
        self._open, self._last = None, None

    def new_page(self) -> None:
        """Blocks never span pages (each keeps an exact page), except a heading that wraps onto
        the next page, which is carried over and may absorb that page's first line."""
        open_block = self._open
        self._carry = (
            open_block
            if open_block and open_block.kind == "heading" and open_block.level in (1, 2)
            else None
        )
        self.close()
        self._prev_line = None

    def add_table(self, table: _Table) -> None:
        self.close()
        self._carry, self._prev_line = None, None
        self.blocks.append(Block("table", None, _markdown_table(table.rows), table.page))

    def _ends_paragraph(self, prev: _Line, line: _Line) -> bool:
        gap = line.top - prev.bottom
        short = prev.x1 < self.right_edge - 0.12 * (self.right_edge - prev.x0)
        ends_sentence = prev.text.rstrip().endswith((".", ":", ";", "!", "?", ".)", '."'))
        return (
            gap > prev.size * 1.2
            or line.size != prev.size
            or abs(line.x0 - prev.x0) > 3
            or (short and ends_sentence)
        )

    def add_line(self, line: _Line) -> None:
        level = _heading_level(line, self._prev_line, self.body, self.levels, self.right_edge)
        carry, self._carry = self._carry, None
        prev, open_block = self._last, self._open
        self._prev_line = line

        if level is not None:
            wraps_here = (
                open_block
                and open_block.kind == "heading"
                and open_block.level == level
                and prev
                and line.top - prev.bottom < line.size * 0.9
            )
            # e.g. "Part 3 – Working Time, Remote Work and" | page break | "On-Call"
            wraps_from_last_page = (
                carry and carry.level == level and split_heading(line.text)[0] is None
            )
            target = open_block if wraps_here else carry if wraps_from_last_page else None
            if target is not None:
                target.text = _join(target.text, line.text, self.vocabulary)
                self._open, self._last = target, line
                return
            self._start(Block("heading", level, line.text, line.page), line)
            return

        is_marker = bool(LIST_MARKER_RE.match(line.text))
        if open_block and prev and open_block.kind == "list":
            if is_marker and abs(line.x0 - self._item_x0) <= 3:
                open_block.text += "\n" + line.text
                self._last = line
                return
            hanging = line.x0 > self._item_x0 + 3 and line.top - prev.bottom < prev.size
            if not is_marker and hanging:
                open_block.text = _join(open_block.text, line.text, self.vocabulary)
                self._last = line
                return
        elif open_block and prev and open_block.kind == "paragraph":
            if not self._ends_paragraph(prev, line):
                open_block.text = _join(open_block.text, line.text, self.vocabulary)
                self._last = line
                return

        if is_marker:
            self._start(Block("list", None, line.text, line.page), line)
            self._item_x0 = line.x0
        else:
            self._start(Block("paragraph", None, line.text, line.page), line)

    def _start(self, block: Block, line: _Line) -> None:
        self.blocks.append(block)
        self._open, self._last = block, line


def _markdown_table(rows: list[list[str]]) -> str:
    def fmt(row: list[str]) -> str:
        return "| " + " | ".join(cell.replace("|", "\\|") for cell in row) + " |"

    header, *body = rows
    lines = [fmt(header), "| " + " | ".join("---" for _ in header) + " |"]
    lines.extend(fmt(row) for row in body)
    return "\n".join(lines)


def _skip_contents(blocks: list[Block]) -> list[Block]:
    """Drop a table of contents: from its heading up to the next heading at its level or above.
    If no such heading follows, keep everything (better noisy than empty)."""
    for start, block in enumerate(blocks):
        if block.kind == "heading" and TOC_RE.match(block.text.strip()):
            level = block.level or 3
            for end in range(start + 1, len(blocks)):
                nxt = blocks[end]
                if nxt.kind == "heading" and (nxt.level or 3) <= level:
                    return blocks[:start] + _skip_contents(blocks[end:])
            return blocks
    return blocks


def _title_blocks(blocks: list[Block]) -> list[Block]:
    """Page-1 level-1 headings before any other content: the entity and/or title."""
    titles = []
    for block in blocks:
        if block.page != 1 or block.kind != "heading" or block.level != 1:
            break
        titles.append(block)
    return titles


def build_outline(blocks: list[Block], skip: set[int] | None = None) -> list[dict[str, Any]]:
    outline = []
    for index, block in enumerate(blocks):
        if block.kind != "heading" or block.level not in (1, 2) or (skip and index in skip):
            continue
        number, title = split_heading(block.text)
        outline.append({"number": number, "title": title, "page": block.page, "level": block.level})
    return outline


def extract_header(source: str | Path | bytes) -> dict[str, Any]:
    """Only the header table (pages 1–2), without parsing the whole document."""
    stream = io.BytesIO(source) if isinstance(source, bytes) else source
    with pdfplumber.open(stream) as pdf:
        for number, page in enumerate(pdf.pages[:2], start=1):
            for table in _extract_page(page, number)[1]:
                if table.is_header:
                    return parse_header_rows(table.rows)
    return {}


def parse_pdf(source: str | Path | bytes) -> ParsedDocument:
    """Parse a PDF (path or bytes). CPU-bound: run it in a worker thread."""
    stream = io.BytesIO(source) if isinstance(source, bytes) else source
    with pdfplumber.open(stream) as pdf:
        page_count = len(pdf.pages)
        pages = [_extract_page(page, number) for number, page in enumerate(pdf.pages, start=1)]

    all_lines = [line for lines, _ in pages for line in lines]
    if not all_lines and not any(tables for _, tables in pages):
        return ParsedDocument(pages=page_count, header={}, title_lines=[], blocks=[])

    line_sizes = Counter(line.size for line in all_lines)
    body = line_sizes.most_common(1)[0][0] if line_sizes else 12.0
    levels = _heading_levels(all_lines, body)
    vocabulary = {word.lower() for line in all_lines for word in WORD_RE.findall(line.text)}
    body_edges = sorted(line.x1 for line in all_lines if line.size == body)
    right_edge = body_edges[int(len(body_edges) * 0.95)] if body_edges else 540.0

    builder = _Builder(body, levels, vocabulary, right_edge)
    header: dict[str, Any] = {}
    for lines, tables in pages:
        builder.new_page()
        items: list[tuple[float, int, Any]] = [(line.top, 1, line) for line in lines]
        items += [(table.top, 0, table) for table in tables]
        for _, _, item in sorted(items, key=lambda entry: (entry[0], entry[1])):
            if isinstance(item, _Table):
                # The header table sits on page 1 (page 2 in the International Supplement).
                if item.is_header and not header and item.page <= 2:
                    header = parse_header_rows(item.rows)
                builder.add_table(item)
            else:
                builder.add_line(item)

    titles = _title_blocks(builder.blocks)
    title_ids = {id(block) for block in titles}
    blocks = _skip_contents(builder.blocks)
    skip = {i for i, b in enumerate(blocks) if id(b) in title_ids}
    return ParsedDocument(
        pages=page_count,
        header=header,
        title_lines=[block.text for block in titles],
        blocks=blocks,
        outline=build_outline(blocks, skip),
    )
