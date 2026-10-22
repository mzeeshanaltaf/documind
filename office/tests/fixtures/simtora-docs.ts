import type { ScopeDocument } from "@/lib/scope";

export function doc(code: string, department: string, jurisdiction: string, doc_type: string, indexed = true): ScopeDocument {
  return { id: `id-${code}`, title: code, doc_code: code, department, jurisdiction, doc_type, indexed_at: indexed ? "2026-10-01T00:00:00Z" : null };
}

/** Simtora's corpus (the dev DB, 2026-10-22). */
export const SIMTORA: ScopeDocument[] = [
  doc("SIM-CMP-001", "Compliance", "GLOBAL", "policy_manual"),
  doc("SIM-FAC-001", "Facilities", "GLOBAL", "policy_manual"),
  doc("SIM-FIN-001", "Finance", "GLOBAL", "policy_manual"),
  doc("SIM-GLB-001", "International", "GLOBAL", "global_supplement"),
  doc("SIM-HR-001", "HR", "US", "policy_manual"),
  doc("SIM-HR-002", "HR", "GLOBAL", "global_supplement"),
  doc("SIM-HR-101", "HR", "PK", "country_supplement"),
  doc("SIM-HR-102", "HR", "DE", "country_supplement"),
  doc("SIM-HR-103", "HR", "FR", "country_supplement"),
  doc("SIM-HR-104", "HR", "AU", "country_supplement"),
  doc("SIM-HR-105", "HR", "GB", "country_supplement"),
  doc("SIM-IT-001", "IT", "GLOBAL", "policy_manual"),
  doc("SIM-OVR-001", "Corporate", "GLOBAL", "overview"),
  doc("SIM-PRC-001", "Procurement", "GLOBAL", "policy_manual"),
];

/** Document codes from scope ids, sorted. */
export const codes = (ids: string[] | null) => (ids ?? []).map((id) => id.replace("id-", "")).sort();
