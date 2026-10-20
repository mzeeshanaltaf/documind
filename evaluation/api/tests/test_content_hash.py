from app.schemas.datasets import CaseFields
from app.services.datasets import canonical_case, content_hash

A = {
    "case_key": "golden-001",
    "type": "single_hop",
    "question": "How long does a PIP last?",
    "expected_doc_codes": ["SIM-HR-001"],
    "expected_sections": ["SIM-HR-001 §2.4"],
    "tags": ["golden"],
}
B = {
    "case_key": "golden-002",
    "type": "jurisdiction",
    "question": "PTO in Germany?",
    "expected_jurisdiction": "DE",
    "key_facts": [{"fact": "30 days", "weight": 1}],
}


def test_hash_is_stable_across_key_order_case_order_and_input_type() -> None:
    reference = content_hash([A, B])
    assert content_hash([B, A]) == reference
    assert content_hash([dict(reversed(list(A.items()))), B]) == reference
    assert content_hash([CaseFields.model_validate(A), CaseFields.model_validate(B)]) == reference
    # Explicit defaults/None are the same content as omitted fields (DB rows carry every column).
    assert content_hash([{**A, "notes": None, "setup_turns": [], "source": "manual"}, B]) == (
        reference
    )
    assert len(reference) == 64


def test_hash_changes_with_content() -> None:
    reference = content_hash([A, B])
    assert content_hash([{**A, "question": "How long does a PIP last? "}, B]) == reference  # strip
    assert content_hash([{**A, "question": "How long is a PIP?"}, B]) != reference
    assert content_hash([{**A, "tags": ["golden", "hr"]}, B]) != reference
    assert content_hash([A]) != reference


def test_canonical_case_has_every_content_field_only() -> None:
    canonical = canonical_case(A)
    # `probes` (E8) is left out unless set, so older versions keep their hash.
    assert set(canonical) == set(CaseFields.model_fields) - {"probes"}
    assert canonical["key_facts"] == []
    assert canonical_case(B)["key_facts"] == [{"fact": "30 days", "weight": 1.0}]
