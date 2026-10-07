from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor
from app.models.auth import member_table, organization_table
from app.schemas.me import OrgAccessOut


async def list_accessible_orgs(session: AsyncSession, actor: Actor) -> list[OrgAccessOut]:
    """Orgs the actor can open: every org for a platform admin, else their memberships."""
    membership = and_(
        member_table.c.organization_id == organization_table.c.id,
        member_table.c.user_id == actor.id,
    )
    query = select(
        organization_table.c.id,
        organization_table.c.name,
        organization_table.c.slug,
        member_table.c.role,
    ).order_by(organization_table.c.name)
    query = (
        query.select_from(organization_table.outerjoin(member_table, membership))
        if actor.is_admin
        else query.select_from(organization_table.join(member_table, membership))
    )
    rows = (await session.execute(query)).all()
    return [OrgAccessOut(id=r.id, name=r.name, slug=r.slug, role=r.role) for r in rows]
