import { ORG_LOCATION_OVERRIDES } from "@/content/orgs";
import type { DocumentOut } from "./api-types";
import { COUNTRY_DEFAULTS } from "./country-defaults";

/**
 * An org's office locations (README › Locations), derived from the jurisdictions of its
 * searchable documents, with per-org overrides from `src/content/orgs/`. Pure and client-safe:
 * the location pages derive them on the server, and the globe and the game get the result.
 */

export type LocationRole = "hq" | "office" | "hub";

/** O4 builds one landmark set per kit; `generic` is a skyline with a city-name sign. */
export const LANDMARK_KITS = [
  "golden-gate",
  "minar",
  "brandenburg",
  "eiffel",
  "opera-house",
  "elizabeth-tower",
  "generic",
  "global-hub",
] as const;
export type LandmarkKit = (typeof LANDMARK_KITS)[number];

/** City scene colours (O4): street ground, building facades (picked per building), one accent. */
export type Palette = { ground: string; buildings: string[]; accent: string };

export type Location = {
  /** URL slug: `/[orgSlug]/[location]`. */
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 (GB, not UK); null for Worldwide. */
  country: string | null;
  role: LocationRole;
  /** What the card says: "Headquarters", "R&D centre", "Office", "Worldwide". */
  roleLabel: string;
  /** Null when there's no single place: Worldwide, or a country without a default city. */
  lat: number | null;
  lon: number | null;
  /** IANA zone for the local time and the lighting (UTC for Worldwide). */
  timezone: string;
  landmarkKit: LandmarkKit;
  palette: Palette;
  /** The local documents' codes (all codes for Worldwide), sorted. */
  docCodes: string[];
};

/** One org's hand-made location for a country (`src/content/orgs/<slug>.ts`). */
export type LocationOverride = {
  country: string;
  id: string;
  name: string;
  role: "hq" | "office";
  roleLabel?: string;
  lat: number;
  lon: number;
  timezone: string;
  landmarkKit: LandmarkKit;
  palette?: Palette;
};

export const WORLDWIDE_ID = "worldwide";
export const WORLDWIDE_NAME = "Global Hub";

/** Location ids in URLs and in `players.settings.last_location`. */
export const LOCATION_ID = /^[a-z0-9-]{1,40}$/;

const ROLE_LABELS: Record<LocationRole, string> = { hq: "Headquarters", office: "Office", hub: "Worldwide" };

export const GENERIC_PALETTE: Palette = {
  ground: "#c9cfc8",
  buildings: ["#e6e8e3", "#d3d8d2", "#bcc4bf"],
  accent: "#2f6f5e",
};

const HUB_PALETTE: Palette = {
  ground: "#d8e0da",
  buildings: ["#eef1ec", "#dfe6e1", "#cdd8d1"],
  accent: "#2f6f5e",
};

type LocationDocument = Pick<DocumentOut, "jurisdiction" | "doc_code" | "indexed_at">;

/** ISO-2, upper case, with the UK alias folded into GB; null for GLOBAL, blanks and junk. */
export function normalizeCountry(jurisdiction: string | null | undefined): string | null {
  const code = jurisdiction?.trim().toUpperCase();
  if (!code || code === "GLOBAL" || !/^[A-Z]{2}$/.test(code)) return null;
  return code === "UK" ? "GB" : code;
}

/** "Washington, D.C." → "washington-d-c"; "Brasília" → "brasilia". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

/** "PK" → "Pakistan" (English names from Intl; the code itself if Intl doesn't know it). */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function overridesFor(orgSlug: string): LocationOverride[] {
  return ORG_LOCATION_OVERRIDES[orgSlug] ?? [];
}

/**
 * The org's locations: one per distinct country among its searchable documents (GLOBAL ones
 * belong everywhere, so they make no location), from the org's override for that country or the
 * country's default city. HQ first, then by name; Worldwide is always last.
 */
export function deriveLocations(
  org: { slug: string },
  documents: LocationDocument[],
  overrides: LocationOverride[] = overridesFor(org.slug),
): Location[] {
  const searchable = documents.filter((doc) => doc.indexed_at !== null);
  const codesByCountry = new Map<string, Set<string>>();
  for (const doc of searchable) {
    const country = normalizeCountry(doc.jurisdiction);
    if (!country) continue;
    const codes = codesByCountry.get(country) ?? new Set<string>();
    if (doc.doc_code) codes.add(doc.doc_code);
    codesByCountry.set(country, codes);
  }

  const byCountry = new Map(overrides.map((override) => [normalizeCountry(override.country), override]));
  // Overrides keep their ids; a default city that would clash gets the country appended.
  const taken = new Set([WORLDWIDE_ID]);
  for (const country of codesByCountry.keys()) {
    const override = byCountry.get(country);
    if (override) taken.add(override.id);
  }
  const locations: Location[] = [];

  for (const [country, codes] of codesByCountry) {
    const docCodes = [...codes].sort();
    const override = byCountry.get(country);
    if (override) {
      locations.push({
        id: override.id,
        name: override.name,
        country,
        role: override.role,
        roleLabel: override.roleLabel ?? ROLE_LABELS[override.role],
        lat: override.lat,
        lon: override.lon,
        timezone: override.timezone,
        landmarkKit: override.landmarkKit,
        palette: override.palette ?? GENERIC_PALETTE,
        docCodes,
      });
      continue;
    }
    const fallback = COUNTRY_DEFAULTS[country];
    const name = fallback?.city ?? countryName(country);
    let id = slugify(name) || country.toLowerCase();
    if (taken.has(id)) id = `${id}-${country.toLowerCase()}`;
    taken.add(id);
    locations.push({
      id,
      name,
      country,
      role: "office",
      roleLabel: ROLE_LABELS.office,
      lat: fallback?.lat ?? null,
      lon: fallback?.lon ?? null,
      timezone: fallback?.timezone ?? "UTC",
      landmarkKit: "generic",
      palette: GENERIC_PALETTE,
      docCodes,
    });
  }

  locations.sort((a, b) => {
    if (a.role === "hq" && b.role !== "hq") return -1;
    if (b.role === "hq" && a.role !== "hq") return 1;
    return a.name.localeCompare(b.name, "en");
  });

  const allCodes = new Set(searchable.flatMap((doc) => (doc.doc_code ? [doc.doc_code] : [])));
  locations.push({
    id: WORLDWIDE_ID,
    name: WORLDWIDE_NAME,
    country: null,
    role: "hub",
    roleLabel: ROLE_LABELS.hub,
    lat: null,
    lon: null,
    timezone: "UTC",
    landmarkKit: "global-hub",
    palette: HUB_PALETTE,
    docCodes: [...allCodes].sort(),
  });
  return locations;
}

/**
 * The display name for a stored location id without fetching the org's documents (the home's
 * "Resume in Lahore"). Null when it can't be told from the id alone.
 */
export function locationNameFromId(orgSlug: string, id: string): string | null {
  if (id === WORLDWIDE_ID) return WORLDWIDE_NAME;
  const override = overridesFor(orgSlug).find((o) => o.id === id);
  if (override) return override.name;
  const fallback = Object.values(COUNTRY_DEFAULTS).find((d) => slugify(d.city) === id);
  return fallback?.city ?? null;
}
