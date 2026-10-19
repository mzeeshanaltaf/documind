"""Create (or repair) the harness's two DocuMind service users, idempotently.

- `eval-bot@documind.zeeshanai.cloud`: platform admin; the account every eval call runs as.
- `eval-probe@documind.zeeshanai.cloud`: a plain user, member of `--org-slug` only (authz
  probes, E8).

Neither gets an `account` row, so neither can sign in (any found are removed, with their
sessions). Writes go straight into DocuMind's Better Auth tables (`EVAL_AUTH_SCHEMA`); the ids
are printed for `.env.local`.

    uv run python -m scripts.bootstrap_service_users [--org-slug simtora] [--dry-run]
"""

import argparse
import asyncio
import secrets
import string
import sys
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import SessionLocal, engine

ID_ALPHABET = string.ascii_letters + string.digits


@dataclass(frozen=True)
class ServiceUser:
    email: str
    name: str
    role: str
    env_key: str


BOT = ServiceUser(
    "eval-bot@documind.zeeshanai.cloud", "Evaluation service", "admin", "EVAL_SERVICE_USER_ID"
)
PROBE = ServiceUser(
    "eval-probe@documind.zeeshanai.cloud", "Evaluation probe", "user", "EVAL_PROBE_USER_ID"
)


def new_id() -> str:
    """Better Auth's default id shape: 32 random alphanumerics."""
    return "".join(secrets.choice(ID_ALPHABET) for _ in range(32))


class Bootstrap:
    def __init__(self, session: AsyncSession, schema: str) -> None:
        self.session, self.s = session, f'"{schema}"'
        self.log: list[str] = []

    async def q(self, sql: str, **params: object):  # noqa: ANN201 — a Result
        return await self.session.execute(text(sql.replace("{s}", self.s)), params)

    async def org_id(self, slug: str) -> str:
        org_id = (
            await self.q("SELECT id FROM {s}.organization WHERE slug = :slug", slug=slug)
        ).scalar()
        if org_id is None:
            raise SystemExit(f"DocuMind has no organization with slug {slug!r}.")
        return org_id

    async def ensure_user(self, user: ServiceUser) -> str:
        row = (
            await self.q(
                'SELECT id, name, role, "emailVerified" AS verified, banned FROM {s}."user" '
                "WHERE lower(email) = lower(:email)",
                email=user.email,
            )
        ).one_or_none()
        if row is None:
            user_id = new_id()
            await self.q(
                'INSERT INTO {s}."user" (id, name, email, "emailVerified", role, banned, '
                '"createdAt", "updatedAt") VALUES (:id, :name, :email, true, :role, false, '
                "now(), now())",
                id=user_id,
                name=user.name,
                email=user.email,
                role=user.role,
            )
            self.log.append(f"created {user.email} ({user.role})")
            return user_id

        if (row.name, row.role, row.verified, bool(row.banned)) != (
            user.name,
            user.role,
            True,
            False,
        ):
            await self.q(
                'UPDATE {s}."user" SET name = :name, role = :role, "emailVerified" = true, '
                'banned = false, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = now() '
                "WHERE id = :id",
                id=row.id,
                name=user.name,
                role=user.role,
            )
            self.log.append(f"updated {user.email} (name/role/verified/ban)")
        else:
            self.log.append(f"unchanged {user.email}")
        return row.id

    async def forbid_sign_in(self, user_id: str, email: str) -> None:
        accounts = (
            await self.q('DELETE FROM {s}.account WHERE "userId" = :id RETURNING id', id=user_id)
        ).all()
        sessions = (
            await self.q('DELETE FROM {s}.session WHERE "userId" = :id RETURNING id', id=user_id)
        ).all()
        if accounts or sessions:
            self.log.append(
                f"removed {len(accounts)} account and {len(sessions)} session row(s) of {email}"
            )

    async def ensure_only_member_of(self, user_id: str, org_id: str, slug: str) -> None:
        rows = (
            await self.q(
                'SELECT id, "organizationId" AS org_id FROM {s}.member WHERE "userId" = :id',
                id=user_id,
            )
        ).all()
        others = [r.id for r in rows if r.org_id != org_id]
        if others:
            await self.q("DELETE FROM {s}.member WHERE id = ANY(:ids)", ids=others)
            self.log.append(f"removed {len(others)} membership(s) outside {slug}")
        if any(r.org_id == org_id for r in rows):
            self.log.append(f"probe already a member of {slug}")
            return
        await self.q(
            'INSERT INTO {s}.member (id, "organizationId", "userId", role, "createdAt") '
            "VALUES (:id, :org, :user, 'member', now())",
            id=new_id(),
            org=org_id,
            user=user_id,
        )
        self.log.append(f"added the probe to {slug} as member")


async def main(org_slug: str, dry_run: bool) -> int:
    schema = get_settings().eval_auth_schema
    async with SessionLocal() as session:
        boot = Bootstrap(session, schema)
        org_id = await boot.org_id(org_slug)
        ids = {}
        for user in (BOT, PROBE):
            ids[user.env_key] = await boot.ensure_user(user)
            await boot.forbid_sign_in(ids[user.env_key], user.email)
        await boot.ensure_only_member_of(ids[PROBE.env_key], org_id, org_slug)
        if dry_run:
            await session.rollback()
        else:
            await session.commit()
    await engine.dispose()

    print(f"Auth schema {schema}{' (dry run: rolled back)' if dry_run else ''}:")
    for line in boot.log:
        print(f"  - {line}")
    print("\nNot saved (dry run):" if dry_run else "\nPut these in the root .env.local:")
    for key, value in ids.items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--org-slug", default="simtora", help="the probe's only org")
    parser.add_argument("--dry-run", action="store_true", help="show the changes, then roll back")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.org_slug, args.dry_run)))
