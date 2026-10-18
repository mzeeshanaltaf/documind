"""Router output normalization, the clarification policy, history layout and specialists."""

import uuid

from app.agents.catalog import Catalog, CatalogDoc
from app.agents.router import (
    HISTORY_TURNS,
    MAX_PARTS,
    HistoryTurn,
    history_input,
    normalize_route,
)
from app.agents.specialists import specialist_instructions
from app.rag.hybrid import SearchFilter


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
        "parts": [],
        "needs_clarification": False,
        "clarifying_question": None,
    }
    return base | overrides


def part(query: str, departments: list[str], jurisdiction: str | None = None) -> dict[str, object]:
    return {"query": query, "departments": departments, "jurisdiction": jurisdiction}


def test_departments_are_matched_to_the_catalog() -> None:
    route = normalize_route(
        raw(departments=["hr", "Legal", "IT", "HR", "Facilities"]), CATALOG, "q"
    )
    assert route.departments == ["HR", "IT", "Facilities"]


def test_jurisdiction_is_normalized() -> None:
    assert normalize_route(raw(jurisdiction="UK"), CATALOG, "q").jurisdiction == "GB"
    assert normalize_route(raw(jurisdiction="GLOBAL"), CATALOG, "q").jurisdiction is None
    assert normalize_route(raw(jurisdiction="Germany"), CATALOG, "q").jurisdiction is None


def test_single_question_searches_the_standalone_query() -> None:
    route = normalize_route(raw(), CATALOG, "q")
    assert route.parts == [] and route.queries == ["How much leave do I get?"]
    assert normalize_route(raw(standalone_query=""), CATALOG, "orig").standalone_query == "orig"
    # One part is just the question again.
    assert normalize_route(raw(parts=[part("A?", ["IT"])]), CATALOG, "q").parts == []


def test_parts_keep_their_own_departments_and_jurisdiction() -> None:
    route = normalize_route(
        raw(
            departments=["HR"],
            parts=[
                part("Password rules?", ["it", "Legal"]),
                part("password rules?", ["IT"]),  # duplicate
                part(" ", ["HR"]),
                part("Dogs in the office?", ["Facilities"], "GLOBAL"),
                part("Leave in Germany?", ["HR"], "Germany"),
                part("Leave in France?", ["HR"], "FR"),
                part("Anything else?", []),
            ],
        ),
        CATALOG,
        "q",
    )
    assert [(p.query, p.departments, p.jurisdiction) for p in route.parts] == [
        ("Password rules?", ["IT"], None),
        ("Dogs in the office?", ["Facilities"], None),
        ("Leave in Germany?", ["HR"], None),  # not an ISO code
        ("Leave in France?", ["HR"], "FR"),
        ("Anything else?", [], None),
    ]
    assert route.departments == ["IT", "Facilities", "HR"]  # the parts' union
    assert route.queries == route.sub_queries == [p.query for p in route.parts]
    assert route.as_dict()["sub_queries"] == route.sub_queries


def test_parts_inherit_the_message_jurisdiction_and_are_capped() -> None:
    parts = [part(f"Q{i}?", ["HR"]) for i in range(MAX_PARTS + 2)]
    route = normalize_route(raw(jurisdiction="DE", parts=parts), CATALOG, "q")
    assert len(route.parts) == MAX_PARTS
    assert {p.jurisdiction for p in route.parts} == {"DE"}


def test_retrieval_parts() -> None:
    vectors = [[0.1], [0.2]]
    route = normalize_route(
        raw(parts=[part("A?", ["HR", "IT"], "FR"), part("B?", [])]), CATALOG, "q"
    )
    first, second = route.retrieval_parts(vectors)
    assert (first.query, first.vector, first.jurisdiction) == ("A?", [0.1], "FR")
    assert first.filters == (SearchFilter(departments=("HR",)), SearchFilter(departments=("IT",)))
    assert second.filters == (SearchFilter(),)
    # Scoped to documents: every part searches just those.
    doc_id = uuid.uuid4()
    scoped = route.retrieval_parts(None, [doc_id])
    assert {p.filters for p in scoped} == {(SearchFilter(document_ids=(doc_id,)),)}
    assert scoped[0].vector is None
    # A single question is one part with the route's own filters.
    (single,) = normalize_route(raw(jurisdiction="DE"), CATALOG, "q").retrieval_parts([[0.3]])
    assert (single.query, single.jurisdiction) == ("How much leave do I get?", "DE")
    assert single.filters == (SearchFilter(departments=("HR",)),)


def test_clarification_only_when_policy_allows() -> None:
    ask = {"needs_clarification": True, "clarifying_question": "Which country are you in?"}
    # HR has several country versions and no country was given: allowed.
    route = normalize_route(raw(**ask), CATALOG, "q")
    assert route.needs_clarification and route.clarifying_question
    # A country was given: never.
    assert not normalize_route(raw(**ask, jurisdiction="DE"), CATALOG, "q").needs_clarification
    # IT has a single (global) version: never.
    assert not normalize_route(raw(**ask, departments=["IT"]), CATALOG, "q").needs_clarification
    # A multi-part message: never (the other parts would go unanswered).
    two = [part("Leave?", ["HR"]), part("Dogs?", ["Facilities"])]
    assert not normalize_route(raw(**ask, parts=two), CATALOG, "q").needs_clarification
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
