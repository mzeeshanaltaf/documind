import { describe, expect, it } from "vitest";
import type { DocumentOut } from "@/lib/api-types";
import {
  deriveLocations,
  LOCATION_ID,
  locationNameFromId,
  normalizeCountry,
  slugify,
  WORLDWIDE_ID,
} from "@/lib/locations";

type Doc = Pick<DocumentOut, "jurisdiction" | "doc_code" | "indexed_at">;

const INDEXED = "2026-10-10T09:00:00Z";
const doc = (doc_code: string | null, jurisdiction: string | null, indexed_at: string | null = INDEXED): Doc => ({
  doc_code,
  jurisdiction,
  indexed_at,
});

/** Simtora's corpus as it is on dev (14 policy PDFs; SIM-HR-001 is the US base manual). */
const SIMTORA: Doc[] = [
  doc("SIM-CMP-001", "GLOBAL"),
  doc("SIM-FAC-001", "GLOBAL"),
  doc("SIM-FIN-001", "GLOBAL"),
  doc("SIM-GLB-001", "GLOBAL"),
  doc("SIM-HR-001", "US"),
  doc("SIM-HR-002", "GLOBAL"),
  doc("SIM-HR-101", "PK"),
  doc("SIM-HR-102", "DE"),
  doc("SIM-HR-103", "FR"),
  doc("SIM-HR-104", "AU"),
  doc("SIM-HR-105", "GB"),
  doc("SIM-IT-001", "GLOBAL"),
  doc("SIM-OVR-001", "GLOBAL"),
  doc("SIM-PRC-001", "GLOBAL"),
];

describe("deriveLocations", () => {
  it("gives Simtora its six offices, HQ first, then Worldwide", () => {
    const locations = deriveLocations({ slug: "simtora" }, SIMTORA);
    expect(locations.map((l) => l.id)).toEqual([
      "san-francisco",
      "berlin",
      "lahore",
      "london",
      "paris",
      "sydney",
      WORLDWIDE_ID,
    ]);

    const [hq] = locations;
    expect(hq).toMatchObject({ name: "San Francisco", country: "US", role: "hq", roleLabel: "Headquarters" });
    expect(hq.timezone).toBe("America/Los_Angeles");
    expect(hq.landmarkKit).toBe("golden-gate");
    expect(hq.docCodes).toEqual(["SIM-HR-001"]);

    const lahore = locations.find((l) => l.id === "lahore")!;
    expect(lahore).toMatchObject({ country: "PK", role: "office", roleLabel: "R&D centre", landmarkKit: "minar" });
    expect(lahore.docCodes).toEqual(["SIM-HR-101"]);
    expect(lahore.lat).toBeCloseTo(31.52, 1);

    const worldwide = locations.at(-1)!;
    expect(worldwide).toMatchObject({ name: "Global Hub", country: null, role: "hub", lat: null, lon: null });
    expect(worldwide.docCodes).toHaveLength(SIMTORA.length);
    expect(locations.every((l) => LOCATION_ID.test(l.id))).toBe(true);
  });

  it("gives an org with only GLOBAL documents just Worldwide", () => {
    const locations = deriveLocations({ slug: "acme" }, [doc("ACM-1", "GLOBAL"), doc("ACM-2", null)]);
    expect(locations.map((l) => l.id)).toEqual([WORLDWIDE_ID]);
    expect(locations[0].docCodes).toEqual(["ACM-1", "ACM-2"]);
  });

  it("uses the default capital for a country without an override", () => {
    const locations = deriveLocations({ slug: "acme" }, [doc("ACM-JP", "JP"), doc("ACM-UK", "uk"), doc("ACM-IS", "IS")]);
    const byCountry = Object.fromEntries(locations.map((l) => [l.country, l]));

    expect(byCountry.JP).toMatchObject({ id: "tokyo", name: "Tokyo", timezone: "Asia/Tokyo", role: "office" });
    expect(byCountry.JP).toMatchObject({ roleLabel: "Office", landmarkKit: "generic" });
    expect(byCountry.JP.lat).toBeCloseTo(35.68, 1);
    // UK is folded into GB, London.
    expect(byCountry.GB).toMatchObject({ id: "london", name: "London" });
    // A country missing from the table still gets a location, without a pin.
    expect(byCountry.IS).toMatchObject({ id: "iceland", name: "Iceland", lat: null, lon: null, timezone: "UTC" });
    // No override means no HQ: sorted by name.
    expect(locations.map((l) => l.id)).toEqual(["iceland", "london", "tokyo", WORLDWIDE_ID]);
  });

  it("ignores documents that aren't indexed", () => {
    const locations = deriveLocations({ slug: "simtora" }, [
      ...SIMTORA,
      doc("SIM-HR-106", "JP", null),
      doc("SIM-HR-107", "DE", null),
    ]);
    expect(locations.map((l) => l.id)).not.toContain("tokyo");
    expect(locations.find((l) => l.id === "berlin")!.docCodes).toEqual(["SIM-HR-102"]);
    expect(locations.at(-1)!.docCodes).not.toContain("SIM-HR-106");
  });

  it("keeps ids unique when two countries share a default city name", () => {
    const locations = deriveLocations({ slug: "acme" }, [doc("A", "DE"), doc("B", "AT")], [
      { country: "AT", id: "berlin", name: "Berlin", role: "office", lat: 0, lon: 0, timezone: "UTC", landmarkKit: "generic" },
    ]);
    expect(locations.map((l) => l.id).sort()).toEqual(["berlin", "berlin-de", WORLDWIDE_ID].sort());
  });
});

describe("location helpers", () => {
  it("normalizes jurisdictions", () => {
    expect(normalizeCountry("pk")).toBe("PK");
    expect(normalizeCountry("UK")).toBe("GB");
    expect(normalizeCountry("GLOBAL")).toBeNull();
    expect(normalizeCountry("EU-WIDE")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
  });

  it("slugifies city names", () => {
    expect(slugify("San Francisco")).toBe("san-francisco");
    expect(slugify("Washington, D.C.")).toBe("washington-d-c");
    expect(slugify("Brasília")).toBe("brasilia");
    expect(slugify("Bogotá")).toBe("bogota");
  });

  it("names a stored location id without the documents", () => {
    expect(locationNameFromId("simtora", "lahore")).toBe("Lahore");
    expect(locationNameFromId("simtora", WORLDWIDE_ID)).toBe("Global Hub");
    expect(locationNameFromId("acme", "tokyo")).toBe("Tokyo");
    expect(locationNameFromId("acme", "atlantis")).toBeNull();
  });
});
