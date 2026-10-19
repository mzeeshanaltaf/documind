"""Import DocuMind's retrieval golden set (`api/eval/golden.jsonl`) as dataset `golden`,
published, with `expected_departments` read from DocuMind's documents (DocuMind must be up).
Re-running with unchanged content is a no-op.

    uv run python -m scripts.import_golden [--org-slug simtora] [--file PATH]
"""

import argparse
import asyncio
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.db import engine, session_scope
from app.documind.client import DocuMindClient
from app.services.importer import import_golden


async def main(org_slug: str, path: Path) -> int:
    if not get_settings().eval_service_user_id:
        print("EVAL_SERVICE_USER_ID is not set; run scripts.bootstrap_service_users first.")
        return 1
    content = await asyncio.to_thread(path.read_text, encoding="utf-8")
    async with DocuMindClient() as documind, session_scope() as session:
        result = await import_golden(session, documind, content, org_slug=org_slug)
    await engine.dispose()

    version, cases = result.version, result.parsed.cases
    assert version is not None and result.dataset is not None
    state = "unchanged (already published)" if result.unchanged else version.status
    print(f"dataset {result.dataset.slug} v{version.version}: {state}, {len(cases)} cases")
    print(f"content_hash {version.content_hash}")
    missing = [c.case_key for c in cases if not c.expected_departments]
    by_type: dict[str, int] = {}
    for case in cases:
        by_type[case.type] = by_type.get(case.type, 0) + 1
    print("types", dict(sorted(by_type.items())))
    for warning in result.parsed.warnings:
        print(f"warning: {warning}")
    if missing:
        print(f"cases without departments: {', '.join(missing)}")
        return 1
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--org-slug", default="simtora")
    parser.add_argument("--file", type=Path, default=get_settings().golden_file)
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.org_slug, args.file)))
