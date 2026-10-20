"""Export one version of a dataset as a single JSON file (dataset header + canonical cases), to
promote a reviewed dataset to another environment with `scripts.import_dataset`.

    uv run python -m scripts.export_dataset --slug synthetic-v1 [--version N] [--out FILE]

Defaults to the latest published version and `<slug>-v<N>.dataset.json`; `--out -` writes to
stdout (status lines go to stderr).
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import select

from app.core.db import engine, session_scope
from app.models import Dataset
from app.services import datasets as service

FORMAT = "documind-eval-dataset/1"


async def main(slug: str, version_no: int | None, out: str | None) -> int:
    async with session_scope() as session:
        dataset = await session.scalar(select(Dataset).where(Dataset.slug == slug))
        if dataset is None:
            print(f"No dataset {slug!r}.", file=sys.stderr)
            return 1
        versions = await service.versions_of(session, dataset.id)
        if version_no is None:
            version = next((v for v in versions if v.status == "published"), None)
            if version is None:
                print(f"{slug!r} has no published version; pass --version.", file=sys.stderr)
                return 1
        else:
            version = next((v for v in versions if v.version == version_no), None)
            if version is None:
                have = ", ".join(f"v{v.version} ({v.status})" for v in versions)
                print(f"{slug!r} has no v{version_no}; it has {have}.", file=sys.stderr)
                return 1
        cases = await service.cases_of(session, version.id)
        canonical = [service.canonical_case(service.case_content(c)) for c in cases]
        payload = {
            "format": FORMAT,
            "dataset": {
                "slug": dataset.slug,
                "name": dataset.name,
                "kind": dataset.kind,
                "default_org_slug": dataset.default_org_slug,
            },
            "version": version.version,
            "status": version.status,
            "content_hash": service.content_hash(canonical),
            "cases": canonical,
        }
    await engine.dispose()

    text = json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    target = Path(out or f"{slug}-v{version.version}.dataset.json") if out != "-" else None
    if target is None:
        sys.stdout.write(text)
    else:
        await asyncio.to_thread(target.write_text, text, encoding="utf-8")
    where = "stdout" if target is None else str(target)
    print(
        f"{slug} v{version.version} ({version.status}): {len(canonical)} cases, "
        f"content_hash {payload['content_hash'][:12]} -> {where}",
        file=sys.stderr,
    )
    if version.status != "published":
        print("warning: this version is a draft.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--slug", required=True)
    parser.add_argument("--version", type=int)
    parser.add_argument("--out", help="file path, or - for stdout")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.slug, args.version, args.out)))
