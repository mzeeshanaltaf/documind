"""Checks a trivia bank against the policy PDFs it was made from (phase O8 › Policy Trivia).

Every question names a document and a page. `<bank>.evidence.json` maps each question id to
phrases that must all appear on that page: the facts that make the right choice right. This reads
the PDFs with pdfplumber, finds each cited page, and fails when a phrase is missing, a question has
no evidence, or evidence names no question. `--sample N` also prints N random questions with the
text around their evidence, for a human spot check (what the session log records).

From the repo root (pdfplumber lives in the api's environment):

  cd api && uv run python -I ../office/scripts/check-trivia-bank.py \\
      ../office/src/content/orgs/simtora-trivia.json ../docs/policies --sample 20 --seed 1

The document codes are read from each PDF's first page ("Document ... SIM-HR-001").
"""

import argparse
import json
import random
import re
import sys
from pathlib import Path

import pdfplumber

CODE = re.compile(r"\b(SIM-[A-Z]{2,3}-\d{3})\b")


def normalize(text: str) -> str:
    text = text.replace("’", "'").replace("‘", "'").replace("–", "–").replace("—", "—")
    return re.sub(r"\s+", " ", text).lower()


def load_pages(pdf_dir: Path) -> dict[str, dict[int, str]]:
    """Document code -> page number -> normalized text."""
    documents: dict[str, dict[int, str]] = {}
    for path in sorted(pdf_dir.glob("*.pdf")):
        with pdfplumber.open(path) as pdf:
            pages = {number: normalize(page.extract_text() or "") for number, page in enumerate(pdf.pages, start=1)}
        head = " ".join(pages.get(1, "").upper().split()) + " " + " ".join(pages.get(2, "").upper().split())
        match = CODE.search(head)
        if not match:
            print(f"WARNING: no document code found in {path.name}")
            continue
        documents[match.group(1)] = pages
    return documents


def main() -> int:
    # The PDFs hold characters a Windows console can't print (∗, –): never fail on output.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    parser.add_argument("bank", type=Path)
    parser.add_argument("pdfs", type=Path)
    parser.add_argument("--sample", type=int, default=0)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    bank = json.loads(args.bank.read_text(encoding="utf-8"))
    evidence = json.loads(args.bank.with_suffix(".evidence.json").read_text(encoding="utf-8"))
    documents = load_pages(args.pdfs)

    problems = 0
    for question in bank:
        pages = documents.get(question["doc_code"])
        if pages is None:
            print(f"UNKNOWN DOCUMENT {question['id']}: {question['doc_code']}")
            problems += 1
            continue
        text = pages.get(question["page"])
        if text is None:
            print(f"NO SUCH PAGE {question['id']}: {question['doc_code']} p. {question['page']}")
            problems += 1
            continue
        phrases = evidence.get(question["id"])
        if not phrases:
            print(f"NO EVIDENCE {question['id']}")
            problems += 1
            continue
        for phrase in phrases:
            if normalize(phrase) not in text:
                print(f"MISSING {question['id']} ({question['doc_code']} p. {question['page']}): {phrase}")
                problems += 1
    for orphan in sorted(set(evidence) - {q["id"] for q in bank}):
        print(f"EVIDENCE WITHOUT A QUESTION: {orphan}")
        problems += 1

    if args.sample:
        rng = random.Random(args.seed)
        print(f"\n--- {args.sample} sampled questions (seed {args.seed}) ---")
        for question in rng.sample(bank, min(args.sample, len(bank))):
            text = documents[question["doc_code"]][question["page"]]
            first = normalize(evidence[question["id"]][0])
            at = text.find(first)
            excerpt = text[max(0, at - 60) : at + len(first) + 60] if at >= 0 else "(not found)"
            print(f"\n{question['id']}  {question['doc_code']} p. {question['page']}")
            print(f"  Q: {question['question']}")
            print(f"  A: {question['choices'][question['answer']]}")
            print(f"  page says: ...{excerpt}...")

    print(f"\n{len(bank)} questions, {problems} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
