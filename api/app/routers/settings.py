"""Per-org model, service-tier and retrieval settings (platform admin)."""

from fastapi import APIRouter

from app.core.security import AdminDep, OrgDep, SessionDep
from app.schemas.settings import SettingsOut, SettingsUpdate
from app.services import org_settings as service

router = APIRouter(prefix="/orgs/{org_id}/settings", tags=["settings"])


@router.get("")
async def get_settings(org: OrgDep, _: AdminDep, session: SessionDep) -> SettingsOut:
    """Effective settings (env defaults fill unset fields) plus the pricing table for the UI."""
    return SettingsOut.model_validate(await service.get_settings_view(session, org.org_id))


@router.put("")
async def update_settings(
    org: OrgDep, actor: AdminDep, session: SessionDep, body: SettingsUpdate
) -> SettingsOut:
    """Update the sent fields; null resets one to its default. Applies to the next chat."""
    view = await service.update_settings(
        session, org.org_id, body.model_dump(exclude_unset=True), actor.id
    )
    return SettingsOut.model_validate(view)
