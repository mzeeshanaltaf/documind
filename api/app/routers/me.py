from fastapi import APIRouter

from app.core.security import ActorDep, SessionDep
from app.schemas.me import ActorOut, MeOut
from app.services.orgs import list_accessible_orgs

router = APIRouter(tags=["me"])


@router.get("/me")
async def get_me(actor: ActorDep, session: SessionDep) -> MeOut:
    """The acting user and the orgs they can access (smoke test for the key + user flow)."""
    orgs = await list_accessible_orgs(session, actor)
    return MeOut(
        user=ActorOut(id=actor.id, email=actor.email, name=actor.name, is_admin=actor.is_admin),
        orgs=orgs,
    )
