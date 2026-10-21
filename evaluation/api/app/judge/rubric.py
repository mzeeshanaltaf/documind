"""A judge prompt's anchors as data (E9), so human reviewers grade with exactly the rubric the
judge read: the reviewer UI renders what this parses out of the prompt version the run used.

Within one `## <section>` of the system prompt, a `**key**: description` line starts a group,
and `- 5: text` or `` - `label`: text `` lines are its anchors (a section without `**key**`
lines is one unnamed group). Other paragraphs in the section are kept as `notes`.
"""

import re
from dataclasses import asdict, dataclass, field
from typing import Any

HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")
GROUP_RE = re.compile(r"^\*\*([a-z_]+)\*\*:\s*(.*)$")
ANCHOR_RE = re.compile(r"^-\s+(?:`([a-z_]+)`|(\d))\s*:\s*(.+)$")


@dataclass
class Group:
    key: str | None
    description: str = ""
    anchors: list[dict[str, str]] = field(default_factory=list)


def section_lines(system: str, title: str) -> list[str]:
    lines, inside = [], False
    for line in system.splitlines():
        heading = HEADING_RE.match(line)
        if heading:
            inside = heading.group(1).strip().lower() == title.lower()
            continue
        if inside:
            lines.append(line.rstrip())
    return lines


def parse_rubric(system: str, section: str) -> dict[str, Any]:
    """`{section, groups: [{key, description, anchors: [{label, text}]}], notes}`."""
    groups: list[Group] = []
    notes: list[str] = []
    for line in section_lines(system, section):
        if not line.strip():
            continue
        if match := GROUP_RE.match(line):
            groups.append(Group(match.group(1), match.group(2).strip()))
        elif match := ANCHOR_RE.match(line):
            if not groups:
                groups.append(Group(None))
            label = match.group(1) or match.group(2)
            groups[-1].anchors.append({"label": label, "text": match.group(3).strip()})
        else:
            notes.append(line.strip())
    return {"section": section, "groups": [asdict(g) for g in groups], "notes": notes}
