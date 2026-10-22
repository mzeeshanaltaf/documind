import { describe, expect, it } from "vitest";
import type { DocumentOut } from "@/lib/api-types";
import { MAX_SCOPE, type ScopeDocument, scopeFor } from "@/lib/scope";
import { codes, doc, SIMTORA } from "./fixtures/simtora-docs";

// Phase O6 › Tests: `scopeFor`, README › Chat scoping rules 1–6, on Simtora's corpus.

const HR = ["SIM-HR-001", "SIM-HR-002", "SIM-HR-101", "SIM-HR-102", "SIM-HR-103", "SIM-HR-104", "SIM-HR-105"];

describe("scopeFor: department rooms", () => {
  it("Lahore HR gets the base manual, the global supplement and Pakistan's, no other country's", () => {
    const scope = scopeFor(SIMTORA, { department: "HR", country: "PK", placeName: "Lahore" });
    expect(codes(scope.documentIds)).toEqual(["SIM-HR-001", "SIM-HR-002", "SIM-HR-101"]);
    for (const other of ["SIM-HR-102", "SIM-HR-103", "SIM-HR-104", "SIM-HR-105"]) expect(codes(scope.documentIds)).not.toContain(other);
    expect(scope.label).toBe("HR · Lahore · 3 documents");
    expect(scope.fallback).toBe(false);
    // Local first, then the base manual, then global.
    expect(scope.documents.map((d) => d.doc_code)).toEqual(["SIM-HR-101", "SIM-HR-001", "SIM-HR-002"]);
  });

  it("Worldwide HR: 'All' gets all 7 HR documents; Germany gets the base, the global and Germany's", () => {
    const all = scopeFor(SIMTORA, { department: "HR", country: null, placeName: "Global Hub" });
    expect(codes(all.documentIds)).toEqual(HR);
    expect(all.label).toBe("HR · Global Hub · 7 documents");
    const germany = scopeFor(SIMTORA, { department: "HR", country: "DE", placeName: "Germany" });
    expect(codes(germany.documentIds)).toEqual(["SIM-HR-001", "SIM-HR-002", "SIM-HR-102"]);
    expect(germany.label).toBe("HR · Germany · 3 documents");
  });

  it("Lahore Finance gets the (global) finance manual only", () => {
    expect(codes(scopeFor(SIMTORA, { department: "Finance", country: "PK" }).documentIds)).toEqual(["SIM-FIN-001"]);
  });

  it("an empty match falls back to the whole department set", () => {
    const legal = [doc("X-1", "Legal", "DE", "country_supplement"), doc("X-2", "Legal", "FR", "country_supplement")];
    const scope = scopeFor([...SIMTORA, ...legal], { department: "Legal", country: "PK", placeName: "Lahore" });
    expect(scope.fallback).toBe(true);
    expect(codes(scope.documentIds)).toEqual(["X-1", "X-2"]);
  });

  it("the presenter gets the overview documents", () => {
    const scope = scopeFor(SIMTORA, { country: "PK", overviewOnly: true });
    expect(codes(scope.documentIds)).toEqual(["SIM-OVR-001"]);
    expect(scope.label).toBe("Overview · 1 document");
  });
});

describe("scopeFor: reception", () => {
  it("Lahore reception gets every GLOBAL, base and PK document, and no other country's", () => {
    const scope = scopeFor(SIMTORA, { country: "PK", placeName: "Lahore" });
    expect(codes(scope.documentIds)).toEqual(
      ["SIM-CMP-001", "SIM-FAC-001", "SIM-FIN-001", "SIM-GLB-001", "SIM-HR-001", "SIM-HR-002", "SIM-HR-101", "SIM-IT-001", "SIM-OVR-001", "SIM-PRC-001"].sort(),
    );
    expect(scope.label).toBe("Lahore · 10 documents");
    expect(scope.fallback).toBe(false);
    expect(scope.documents[0].doc_code).toBe("SIM-HR-101");
  });

  it("Worldwide reception is unscoped (null: DocuMind routes)", () => {
    const scope = scopeFor(SIMTORA, { country: null, placeName: "Global Hub" });
    expect(scope.documentIds).toBeNull();
    expect(scope.documents).toHaveLength(14);
    expect(scope.label).toBe("Global Hub · all 14 documents");
  });
});

describe("scopeFor: limits", () => {
  it("leaves out unindexed documents", () => {
    const pending = doc("SIM-HR-106", "HR", "PK", "country_supplement", false);
    expect(codes(scopeFor([...SIMTORA, pending], { country: "PK" }).documentIds)).not.toContain("SIM-HR-106");
    expect(codes(scopeFor([...SIMTORA, pending], { department: "HR", country: "PK" }).documentIds)).not.toContain("SIM-HR-106");
  });

  it("caps at 50 documents in priority order: local, then base, then global", () => {
    const globals = Array.from({ length: 60 }, (_, i) => doc(`G-${String(i).padStart(2, "0")}`, "IT", "GLOBAL", "procedure"));
    const scope = scopeFor([...globals, doc("B-1", "IT", "US", "policy_manual"), doc("L-1", "IT", "PK", "country_supplement")], {
      department: "IT",
      country: "PK",
      placeName: "Lahore",
    });
    expect(scope.documentIds).toHaveLength(MAX_SCOPE);
    expect(scope.documentIds?.slice(0, 3)).toEqual(["id-L-1", "id-B-1", "id-G-00"]);
    expect(scope.documentIds).not.toContain("id-G-59");
    expect(scope.label).toBe("IT · Lahore · 50 documents");
  });
});

// A DocumentOut's other fields don't matter to scoping; this keeps the fixture honest.
const _typecheck: Pick<DocumentOut, keyof ScopeDocument> = SIMTORA[0];
void _typecheck;
