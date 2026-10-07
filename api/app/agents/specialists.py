"""Department specialists: a persona plus rules for the synthesizer, and a metadata filter for
retrieval (one filtered search per routed department). Several departments merge their
personas and rules into one set of instructions."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Specialist:
    department: str
    persona: str
    rules: tuple[str, ...] = ()


SPECIALISTS: dict[str, Specialist] = {
    s.department: s
    for s in (
        Specialist(
            "HR",
            "an HR policy specialist who knows the base HR manual, the global people supplement "
            "and every country manual",
            (
                "Country manuals override the base HR manual for employees of that subsidiary — "
                "state which applies.",
                "Give exact entitlements (days, weeks, percentages) and eligibility conditions.",
            ),
        ),
        Specialist(
            "IT",
            "an IT and information-security policy specialist",
            (
                "Name the required controls, approvals and who to contact (e.g. the service desk "
                "or security team).",
            ),
        ),
        Specialist(
            "Finance",
            "a finance and accounting policy specialist",
            ("Quote exact approval thresholds and approvers.",),
        ),
        Specialist(
            "Procurement",
            "a procurement policy specialist",
            (
                "Quote exact approval thresholds and approvers.",
                "Mention required quotes, tenders or vendor checks where the sources give them.",
            ),
        ),
        Specialist(
            "Facilities",
            "a facilities, workplace and office-administration specialist",
            ("Give the practical steps, contacts and any office-specific differences.",),
        ),
        Specialist(
            "Compliance",
            "an ethics and compliance specialist",
            (
                "Point to reporting channels.",
                "Mention non-retaliation protections where the sources cover them.",
            ),
        ),
        Specialist(
            "Corporate",
            "a company-overview specialist who knows the organisation, its entities and leadership",
        ),
        Specialist(
            "International",
            "an international-operations specialist for cross-border work, travel, entities "
            "and local requirements",
            ("Say which country or entity each rule applies to.",),
        ),
    )
}


def specialist_for(department: str) -> Specialist:
    """The registered specialist, or a generic one for any other department."""
    return SPECIALISTS.get(department) or Specialist(
        department, f"a {department} policy specialist"
    )


GENERAL = Specialist(
    "General", "a company policy assistant who knows every document in the catalog"
)


def specialist_instructions(departments: list[str]) -> str:
    """Persona + rules for the routed departments (the general assistant when none)."""
    specialists = [specialist_for(d) for d in departments] or [GENERAL]
    personas = "; ".join(s.persona for s in specialists)
    rules = list(dict.fromkeys(rule for s in specialists for rule in s.rules))
    lines = [f"You are acting as {personas}."]
    if rules:
        lines.append("Specialist rules:")
        lines.extend(f"- {rule}" for rule in rules)
    return "\n".join(lines)
