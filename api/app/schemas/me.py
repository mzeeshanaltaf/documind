from pydantic import BaseModel


class ActorOut(BaseModel):
    id: str
    email: str
    name: str
    is_admin: bool


class OrgAccessOut(BaseModel):
    id: str
    name: str
    slug: str
    role: str | None  # `member.role`; None when a platform admin isn't a member


class MeOut(BaseModel):
    user: ActorOut
    orgs: list[OrgAccessOut]
