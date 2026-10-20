"""Import a file written by `scripts.export_dataset`. The cases become a new version of the
dataset (created if it doesn't exist), published unless `--draft`. Re-importing the content of the
latest published version is a no-op. The imported content hash must equal the exported one.

    uv run python -m scripts.import_dataset --file synthetic-v1-v1.dataset.json [--draft]
    ... | uv run python -m scripts.import_dataset --file -        # read stdin
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.core.db import engine, session_scope
from app.services.importer import ImportOptions, import_jsonl

FORMAT = "documind-eval-dataset/1"


async def main(file: str, draft: bool, dry_run: bool) -> int:
    if file == "-":
        raw = sys.stdin.read()
    else:
        raw = await asyncio.to_thread(Path(file).read_text, "utf-8")
    payload = json.loads(raw)
    if payload.get("format") != FORMAT:
        print(f"Not a {FORMAT} file.")
        return 1
    header = payload["dataset"]
    options = ImportOptions(
        dataset_slug=header["slug"],
        dataset_name=header.get("name"),
        default_org_slug=header.get("default_org_slug"),
        kind=header.get("kind") or "mixed",
        fill_departments=False,  # the file carries them; no DocuMind needed
        publish=not draft,
    )
    content = "".join(json.dumps(case, ensure_ascii=False) + "\n" for case in payload["cases"])
    async with session_scope() as session:
        result = await import_jsonl(
            session, content, options, documind=None, created_by=None, preview=dry_run
        )
    await engine.dispose()

    cases = result.parsed.cases
    if dry_run:
        errors = len(result.parsed.errors)
        print(f"dry run: {header['slug']}: {len(cases)} cases parsed, {errors} errors")
        return 0
    version = result.version
    assert version is not None and result.dataset is not None
    state = "unchanged (already published)" if result.unchanged else version.status
    print(f"dataset {result.dataset.slug} v{version.version}: {state}, {len(cases)} cases")
    print(f"content_hash {version.content_hash}")
    if version.content_hash != payload["content_hash"]:
        print("MISMATCH: the imported content hash differs from the exported one.")
        return 1
    print("content_hash matches the export")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", required=True, help="path, or - for stdin")
    parser.add_argument("--draft", action="store_true", help="leave the new version unpublished")
    parser.add_argument("--dry-run", action="store_true", help="validate only; save nothing")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.file, args.draft, args.dry_run)))
