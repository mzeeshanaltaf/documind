"""Render the leakage canary policy (`evaluation/fixtures/canary/canary-policy.md`) as a PDF in
the Simtora layout, so DocuMind's parser reads it like the seed policies:

- page 1: the title lines (24pt semibold) and the header table (Document ID, Version, Owner, …);
- body 12pt; headings `##` 24pt (parts), `###` 18pt (numbered sections), `####` 15pt;
- a "Page N of M" footer at 9pt.

The PDF is committed next to the markdown; re-run this after editing it (reportlab is a dev
dependency).

    uv run python -m scripts.make_canary_pdf [--out PATH]
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.config import get_settings
from app.services.canary import Canary, load

REGULAR, BOLD = "Helvetica", "Helvetica-Bold"
BODY = ParagraphStyle("body", fontName=REGULAR, fontSize=12, leading=19.5, spaceAfter=12)
CELL = ParagraphStyle("cell", parent=BODY, spaceAfter=0)
CELL_KEY = ParagraphStyle("cell_key", parent=CELL, fontName=BOLD)
HEADINGS = {
    1: ParagraphStyle("h1", fontName=BOLD, fontSize=24, leading=30, spaceBefore=18, spaceAfter=18),
    2: ParagraphStyle("h2", fontName=BOLD, fontSize=18, leading=24, spaceBefore=16, spaceAfter=12),
    3: ParagraphStyle("h3", fontName=BOLD, fontSize=15, leading=20, spaceBefore=12, spaceAfter=8),
}
TITLE = ParagraphStyle("title", parent=HEADINGS[1], alignment=TA_CENTER, spaceBefore=0)
HEADING_RE = re.compile(r"^(#{2,4})\s+(.*)$")
NUMBERED_RE = re.compile(r"^\d+\.\s+(.*)$")


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def body_flowables(markdown: str) -> list[Any]:
    """`##`/`###`/`####` headings, `1.` numbered lists, and paragraphs (blank-line separated)."""
    flowables: list[Any] = []
    items: list[str] = []
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            flowables.append(Paragraph(escape(" ".join(paragraph)), BODY))
            paragraph.clear()
        if items:
            flowables.append(
                ListFlowable(
                    [ListItem(Paragraph(escape(item), BODY), leftIndent=18) for item in items],
                    bulletType="1",
                    bulletFormat="%s.",
                    bulletFontName=REGULAR,
                    bulletFontSize=12,
                    leftIndent=18,
                )
            )
            items.clear()

    for line in markdown.splitlines():
        line = line.rstrip()
        if heading := HEADING_RE.match(line):
            flush()
            level = len(heading.group(1)) - 1
            flowables.append(Paragraph(escape(heading.group(2)), HEADINGS[level]))
        elif numbered := NUMBERED_RE.match(line):
            if paragraph:
                flush()
            items.append(numbered.group(1))
        elif not line:
            flush()
        else:
            paragraph.append(line.strip())
    flush()
    return flowables


def header_table(header: dict[str, str]) -> Table:
    rows = [[Paragraph(escape(k), CELL_KEY), Paragraph(escape(v), CELL)] for k, v in header.items()]
    table = Table(rows, colWidths=[38 * mm, 122 * mm])
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#9CA3AF")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


class NumberedCanvas(Canvas):
    """Draws "Page N of M" once the page count is known."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._pages: list[dict[str, Any]] = []

    def showPage(self) -> None:  # noqa: N802 — reportlab's API
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            self.setFont(REGULAR, 9)
            self.drawCentredString(A4[0] / 2, 12 * mm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


def render(canary: Canary, out: Path) -> None:
    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=24 * mm,
        title=" – ".join(canary.title_lines),
        author=canary.org_name,
    )
    story: list[Any] = [Spacer(1, 18 * mm)]
    story += [Paragraph(escape(line), TITLE) for line in canary.title_lines]
    story += [Spacer(1, 10 * mm), header_table(canary.header), PageBreak()]
    story += body_flowables(canary.body)
    doc.build(story, canvasmaker=NumberedCanvas)


def main(out: Path | None) -> int:
    source = get_settings().canary_file
    canary = load(source)
    out = out or source.with_suffix(".pdf")
    render(canary, out)
    print(f"wrote {out} ({out.stat().st_size} bytes) for {canary.doc_code}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()
    sys.exit(main(args.out))
