"""Seed an org with the policy PDFs, through the same service as `POST /documents`.

    uv run python -m scripts.seed_policies --org-slug simtora [--dir ../docs/policies] [--wait]

Already-uploaded files (same sha256) are skipped. With --wait the queued jobs are processed
inline here instead of by the API's worker.
"""

import argparse
import asyncio
import sys
from pathlib import Path

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.core.log import configure_logging
from app.ingestion import worker
from app.models.auth import organization_table
from app.models.document import Chunk, Document
from app.services import documents as service

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "docs" / "policies"


class _FileReader:
    """Async `read()` over a local file, matching what `spool_upload` expects."""

    def __init__(self, path: Path) -> None:
        self._handle = path.open("rb")

    async def read(self, size: int = -1) -> bytes:
        return self._handle.read(size)

    def close(self) -> None:
        self._handle.close()


async def find_org_id(slug: str) -> str | None:
    async with SessionLocal() as session:
        return (
            await session.execute(
                select(organization_table.c.id).where(organization_table.c.slug == slug)
            )
        ).scalar_one_or_none()


async def upload_all(org_id: str, paths: list[Path]) -> None:
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    for path in paths:
        reader = _FileReader(path)
        try:
            async with (
                service.spool_upload(reader, max_bytes) as spooled,
                SessionLocal() as session,
            ):
                document, _ = await service.create_document(
                    session, org_id=org_id, uploaded_by=None, file_name=path.name, file=spooled
                )
            print(f"  queued     {path.name} → {document.id}")
        except service.DuplicateDocument as exc:
            print(f"  skipped    {path.name} (already uploaded as {exc.existing_id})")
        except service.InvalidUpload as exc:
            print(f"  rejected   {path.name}: {exc}")
        finally:
            reader.close()


async def print_summary(org_id: str) -> None:
    async with SessionLocal() as session:
        counts = (
            select(Chunk.document_id, func.count().label("n"))
            .where(Chunk.org_id == org_id)
            .group_by(Chunk.document_id)
            .subquery()
        )
        rows = (
            await session.execute(
                select(Document, func.coalesce(counts.c.n, 0))
                .outerjoin(counts, counts.c.document_id == Document.id)
                .where(Document.org_id == org_id)
                .order_by(Document.file_name)
            )
        ).all()
    header = f"{'file':46} {'doc_code':12} {'dept':13} {'juris':7} {'chunks':>6}  status"
    print("\n" + header + "\n" + "-" * len(header))
    for document, chunks in rows:
        print(
            f"{(document.file_name or '')[:46]:46} {document.doc_code or '-':12} "
            f"{document.department or '-':13} {document.jurisdiction or '-':7} "
            f"{chunks:>6}  {document.status}"
        )
    print(f"\n{len(rows)} documents, {sum(chunks for _, chunks in rows)} chunks")


async def main(args: argparse.Namespace, paths: list[Path]) -> int:
    configure_logging()
    try:
        org_id = await find_org_id(args.org_slug)
        if org_id is None:
            print(
                f"No organization with slug {args.org_slug!r}. Create it in the web app "
                "(/app/new-org) first.",
                file=sys.stderr,
            )
            return 1
        print(f"Uploading {len(paths)} PDFs from {args.dir} to {args.org_slug} ({org_id})")
        await upload_all(org_id, paths)
        if args.wait:
            print(f"Processing jobs inline (concurrency {args.concurrency})…")
            await worker.run_until_idle(concurrency=args.concurrency, org_id=org_id)
        await print_summary(org_id)
        return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--org-slug", required=True)
    parser.add_argument("--dir", default=str(DEFAULT_DIR))
    parser.add_argument("--wait", action="store_true", help="process the jobs inline")
    parser.add_argument("--concurrency", type=int, default=3, help="inline jobs in parallel")
    arguments = parser.parse_args()
    pdfs = sorted(Path(arguments.dir).resolve().glob("*.pdf"))
    if not pdfs:
        sys.exit(f"No PDFs found in {arguments.dir}")
    sys.exit(asyncio.run(main(arguments, pdfs)))
