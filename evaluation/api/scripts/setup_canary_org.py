"""Create (or repair) the leakage canary org in DocuMind, idempotently (E8).

- The org `eval-canary` ("Canary Holdings (eval)") goes straight into DocuMind's Better Auth
  `organization` table (`EVAL_AUTH_SCHEMA`), with metadata `{"eval": true}` so DocuMind's
  self-service join page hides it. It has no members: the service account reaches it as a
  platform admin, and the probe user must never be one (any membership is removed).
- `canary-policy.pdf` is uploaded through DocuMind's API as the service account, unless a
  document with the canary's code is already there; `--wait` polls until it is indexed.

DocuMind must be up. Run `scripts.make_canary_pdf` first if the markdown changed.

    uv run python -m scripts.setup_canary_org [--wait] [--dry-run]
"""

import argparse
import asyncio
import json
import sys
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import SessionLocal, engine
from app.documind.client import DocuMindClient, DocuMindError
from app.services.canary import Canary, load
from scripts.bootstrap_service_users import new_id

METADATA = {"eval": True, "purpose": "leakage canary (DocuMind Evaluation, E8)"}
WAIT_TIMEOUT_S = 600


class Setup:
    def __init__(self, session: AsyncSession, schema: str) -> None:
        self.session, self.s = session, f'"{schema}"'
        self.log: list[str] = []

    async def q(self, sql: str, **params: object):  # noqa: ANN201 — a Result
        return await self.session.execute(text(sql.replace("{s}", self.s)), params)

    async def ensure_org(self, canary: Canary) -> str:
        row = (
            await self.q(
                "SELECT id, name, metadata FROM {s}.organization WHERE slug = :slug",
                slug=canary.org_slug,
            )
        ).one_or_none()
        metadata = json.dumps(METADATA)
        if row is None:
            org_id = new_id()
            await self.q(
                'INSERT INTO {s}.organization (id, name, slug, "createdAt", metadata) '
                "VALUES (:id, :name, :slug, now(), :metadata)",
                id=org_id,
                name=canary.org_name,
                slug=canary.org_slug,
                metadata=metadata,
            )
            self.log.append(f"created org {canary.org_slug} ({org_id})")
            return org_id
        current = json.loads(row.metadata) if row.metadata else None
        if row.name != canary.org_name or current != METADATA:
            await self.q(
                "UPDATE {s}.organization SET name = :name, metadata = :metadata WHERE id = :id",
                id=row.id,
                name=canary.org_name,
                metadata=metadata,
            )
            self.log.append(f"updated org {canary.org_slug} (name/metadata)")
        else:
            self.log.append(f"org {canary.org_slug} unchanged ({row.id})")
        return row.id

    async def remove_probe(self, org_id: str) -> None:
        probe = get_settings().eval_probe_user_id
        members = (
            await self.q(
                'SELECT id, "userId" AS user_id FROM {s}.member WHERE "organizationId" = :org',
                org=org_id,
            )
        ).all()
        if probe and any(m.user_id == probe for m in members):
            await self.q(
                'DELETE FROM {s}.member WHERE "organizationId" = :org AND "userId" = :user',
                org=org_id,
                user=probe,
            )
            self.log.append("removed the probe user's membership")
        others = [m for m in members if m.user_id != probe]
        if others:
            self.log.append(f"warning: the canary org has {len(others)} other member(s)")


async def upload(canary: Canary, org_id: str, documind: DocuMindClient, *, dry_run: bool) -> None:
    documents = await documind.documents(org_id)
    existing = next((d for d in documents if d.doc_code == canary.doc_code), None)
    if existing is not None:
        print(f"  document {canary.doc_code} already there ({existing.id}, {existing.status})")
        return
    pdf = get_settings().canary_file.with_suffix(".pdf")
    if dry_run:
        print(f"  would upload {pdf.name} ({pdf.stat().st_size} bytes)")
        return
    content = await asyncio.to_thread(pdf.read_bytes)
    try:
        result = await documind.upload_document(org_id, pdf.name, content)
    except DocuMindError as exc:
        if exc.status_code == 409:
            print(f"  {pdf.name} already uploaded ({exc.details})")
            return
        raise
    print(f"  uploaded {pdf.name}: {result['documents'][0]['status']}")


async def wait_ready(canary: Canary, org_id: str, documind: DocuMindClient) -> int:
    deadline = time.monotonic() + WAIT_TIMEOUT_S
    while time.monotonic() < deadline:
        documents = await documind.documents(org_id)
        doc = next((d for d in documents if d.doc_code == canary.doc_code), None)
        if doc is None:
            # The code is read from the header during ingestion: match by file name until then.
            doc = next((d for d in documents if d.status in ("uploaded", "processing")), None)
        status = doc.status if doc else "missing"
        if status == "ready":
            print(f"  {canary.doc_code} ready: {doc.department} / {doc.jurisdiction}")  # type: ignore[union-attr]
            return 0
        if status in ("failed", "missing"):
            print(f"  ingestion {status}")
            return 1
        await asyncio.sleep(3)
    print("  timed out waiting for ingestion")
    return 1


async def main(wait: bool, dry_run: bool) -> int:
    settings = get_settings()
    canary = load()
    async with SessionLocal() as session:
        setup = Setup(session, settings.eval_auth_schema)
        org_id = await setup.ensure_org(canary)
        await setup.remove_probe(org_id)
        if dry_run:
            await session.rollback()
        else:
            await session.commit()
    await engine.dispose()
    print(f"Auth schema {settings.eval_auth_schema}{' (dry run: rolled back)' if dry_run else ''}:")
    for line in setup.log:
        print(f"  - {line}")
    if dry_run and "created" in " ".join(setup.log):
        return 0  # the org doesn't exist in DocuMind yet
    print("DocuMind:")
    async with DocuMindClient() as documind:
        await upload(canary, org_id, documind, dry_run=dry_run)
        if wait and not dry_run:
            return await wait_ready(canary, org_id, documind)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--wait", action="store_true", help="poll until the PDF is indexed")
    parser.add_argument("--dry-run", action="store_true", help="show the changes, then roll back")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.wait, args.dry_run)))
