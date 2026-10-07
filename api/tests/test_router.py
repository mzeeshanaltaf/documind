"""Router output normalization, the clarification policy, history layout and specialists."""

import uuid

from app.agents.catalog import Catalog, CatalogDoc
from app.agents.router import HISTORY_TURNS, HistoryTurn, history_input, normalize_route
from app.agents.specialists import specialist_instructions


def doc(code: str, department: str, jurisdiction: str) -> CatalogDoc:
    return CatalogDoc(
        id=uuid.uuid4(),
        doc_code=code,
        title=code,
        department=department,
        jurisdiction=jurisdiction,
        doc_type="policy_manual",
        owner=f"Owner of {code}",
        applies_to=None,
        summary=None,
    )


CATALOG = Catalog(
    org_id="org",
    departments=("Facilities", "HR", "IT"),
    jurisdictions=("DE", "FR", "GLOBAL", "US"),
    documents=(
        doc("SIM-HR-001", "HR", "US"),
        doc("SIM-HR-102", "HR", "DE"),
        doc("SIM-HR-103", "HR", "FR"),
        doc("SIM-IT-001", "IT", "GLOBAL"),
        doc("SIM-FAC-001", "Facilities", "GLOBAL"),
    ),
)


def raw(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "departments": ["HR"],
        "jurisdiction": None,
        "standalone_query": "How much leave do I get?",
        "sub_queries": [],
        "needs_clarification": False,
        "clarifying_question": None,
    }
    return base | overrides


def test_departments_are_matched_to_the_catalog() -> None:
    route = normalize_route(
        raw(departments=["hr", "Legal", "IT", "HR", "Facilities"]), CATALOG, "q"
    )
    assert route.departments == ["HR", "IT", "Facilities"]


def test_jurisdiction_is_normalized() -> None:
    assert normalize_route(raw(jurisdiction="UK"), CATALOG, "q").jurisdiction == "GB"
    assert normalize_route(raw(jurisdiction="GLOBAL"), CATALOG, "q").jurisdiction is None
    assert normalize_route(raw(jurisdiction="Germany"), CATALOG, "q").jurisdiction is None


def test_sub_queries_are_distinct_and_capped() -> None:
    route = normalize_route(
        raw(sub_queries=["How much leave do I get?", "A?", "A?", "B?", "C?", "D?", " "]),
        CATALOG,
        "q",
    )
    assert route.sub_queries == ["A?", "B?", "C?"]
    assert route.queries == ["How much leave do I get?", "A?", "B?", "C?"]
    assert normalize_route(raw(standalone_query=""), CATALOG, "orig").standalone_query == "orig"


def test_clarification_only_when_policy_allows() -> None:
    ask = {"needs_clarification": True, "clarifying_question": "Which country are you in?"}
    # HR has several country versions and no country was given: allowed.
    route = normalize_route(raw(**ask), CATALOG, "q")
    assert route.needs_clarification and route.clarifying_question
    # A country was given: never.
    assert not normalize_route(raw(**ask, jurisdiction="DE"), CATALOG, "q").needs_clarification
    # IT has a single (global) version: never.
    assert not normalize_route(raw(**ask, departments=["IT"]), CATALOG, "q").needs_clarification
    # No question text: never.
    assert not normalize_route(
        raw(needs_clarification=True, clarifying_question=" "), CATALOG, "q"
    ).needs_clarification


def test_history_input_keeps_recent_turns_then_the_question() -> None:
    history = [HistoryTurn("user" if i % 2 == 0 else "assistant", f"turn {i}") for i in range(10)]
    messages = history_input(history, "And in France?")
    assert len(messages) == HISTORY_TURNS + 1
    assert messages[0]["content"] == "turn 4"
    assert messages[-1] == {"role": "user", "content": "Question: And in France?"}


def test_catalog_helpers() -> None:
    assert CATALOG.jurisdictions_for(["HR"]) == {"US", "DE", "FR"}
    assert CATALOG.owners_for(["IT"]) == ["SIM-IT-001: Owner of SIM-IT-001"]
    rendered = CATALOG.render()
    assert rendered.startswith("Departments: Facilities, HR, IT")
    assert "- SIM-HR-102 | SIM-HR-102 | HR | DE | policy_manual" in rendered


def test_specialist_instructions_merge_personas_and_rules() -> None:
    text = specialist_instructions(["HR", "Finance"])
    assert "HR policy specialist" in text and "finance and accounting" in text
    assert "Country manuals override the base HR manual" in text
    assert "Quote exact approval thresholds and approvers." in text
    assert "a Legal policy specialist" in specialist_instructions(["Legal"])
    assert "company policy assistant" in specialist_instructions([])
