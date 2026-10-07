"""The seed policy PDFs and what their header tables / metadata should produce."""

from functools import lru_cache
from pathlib import Path

from app.ingestion.parser import ParsedDocument, parse_pdf

POLICIES_DIR = Path(__file__).resolve().parents[2] / "docs" / "policies"
HR_MANUAL = POLICIES_DIR / "HR-Policy-Manual.pdf"

# file stem → (doc_code, department, jurisdiction, doc_type), per the Phase 4 plan.
EXPECTED = {
    "HR-Policy-Manual": ("SIM-HR-001", "HR", "US", "policy_manual"),
    "HR-Global-People-Supplement": ("SIM-HR-002", "HR", "GLOBAL", "global_supplement"),
    "HR-Pakistan-Manual": ("SIM-HR-101", "HR", "PK", "country_supplement"),
    "HR-Germany-Manual": ("SIM-HR-102", "HR", "DE", "country_supplement"),
    "HR-France-Manual": ("SIM-HR-103", "HR", "FR", "country_supplement"),
    "HR-Australia-Manual": ("SIM-HR-104", "HR", "AU", "country_supplement"),
    "HR-United-Kingdom-Manual": ("SIM-HR-105", "HR", "GB", "country_supplement"),
    "International-Operations-Supplement": (
        "SIM-GLB-001",
        "International",
        "GLOBAL",
        "global_supplement",
    ),
    "IT-Policy-Manual": ("SIM-IT-001", "IT", "GLOBAL", "policy_manual"),
    "Finance-and-Accounting-Manual": ("SIM-FIN-001", "Finance", "GLOBAL", "policy_manual"),
    "Procurement-Policy-Manual": ("SIM-PRC-001", "Procurement", "GLOBAL", "policy_manual"),
    "Code-of-Ethics-and-Compliance-Manual": (
        "SIM-CMP-001",
        "Compliance",
        "GLOBAL",
        "policy_manual",
    ),
    "Facilities-and-Office-Administration-Manual": (
        "SIM-FAC-001",
        "Facilities",
        "GLOBAL",
        "policy_manual",
    ),
    "Company-Overview": ("SIM-OVR-001", "Corporate", "GLOBAL", "overview"),
}


@lru_cache
def parsed(name: str) -> ParsedDocument:
    """Parse a seed PDF once per test session."""
    return parse_pdf(POLICIES_DIR / f"{name}.pdf")
