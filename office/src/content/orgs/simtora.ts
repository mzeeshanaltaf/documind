import type { LocationOverride } from "@/lib/locations";

/**
 * Simtora Technologies' offices (`Company-Overview.pdf` p.3): headquarters in San Francisco and
 * R&D centres in Lahore, Berlin, Paris, Sydney and London. Keyed by the country of each office's
 * HR supplement (US is the base manual's jurisdiction, hence the HQ). Palettes are the city
 * scenes' (O4): ground, facades, one accent that nods to the place.
 */
export const SIMTORA_LOCATIONS: LocationOverride[] = [
  {
    country: "US",
    id: "san-francisco",
    name: "San Francisco",
    role: "hq",
    lat: 37.7749,
    lon: -122.4194,
    timezone: "America/Los_Angeles",
    landmarkKit: "golden-gate",
    palette: { ground: "#c9cfc2", buildings: ["#ece6da", "#dcd5c6", "#c6cdc9"], accent: "#c0462f", floors: [4, 11] },
  },
  {
    country: "PK",
    id: "lahore",
    name: "Lahore",
    role: "office",
    roleLabel: "R&D centre",
    lat: 31.5204,
    lon: 74.3587,
    timezone: "Asia/Karachi",
    landmarkKit: "minar",
    palette: { ground: "#d6c9ad", buildings: ["#e9dbc0", "#dbb894", "#c9936f"], accent: "#2f7d4f", floors: [2, 6] },
  },
  {
    country: "DE",
    id: "berlin",
    name: "Berlin",
    role: "office",
    roleLabel: "R&D centre",
    lat: 52.52,
    lon: 13.405,
    timezone: "Europe/Berlin",
    landmarkKit: "brandenburg",
    palette: { ground: "#c8ccc6", buildings: ["#e6e2d9", "#cfc9bd", "#b9bdb8"], accent: "#3a4a5c", floors: [4, 8] },
  },
  {
    country: "FR",
    id: "paris",
    name: "Paris",
    role: "office",
    roleLabel: "R&D centre",
    lat: 48.8566,
    lon: 2.3522,
    timezone: "Europe/Paris",
    landmarkKit: "eiffel",
    palette: { ground: "#d3cdbf", buildings: ["#ede5d3", "#e0d5bd", "#c9bfa8"], accent: "#2e4a6b", floors: [5, 7] },
  },
  {
    country: "AU",
    id: "sydney",
    name: "Sydney",
    role: "office",
    roleLabel: "R&D centre",
    lat: -33.8688,
    lon: 151.2093,
    timezone: "Australia/Sydney",
    landmarkKit: "opera-house",
    palette: { ground: "#cdd4c4", buildings: ["#eef0ea", "#d9dfdb", "#c3cdd0"], accent: "#2a7fa8", floors: [5, 13] },
  },
  {
    country: "GB",
    id: "london",
    name: "London",
    role: "office",
    roleLabel: "R&D centre",
    lat: 51.5074,
    lon: -0.1278,
    timezone: "Europe/London",
    landmarkKit: "elizabeth-tower",
    palette: { ground: "#c4c9c2", buildings: ["#ddd6c8", "#c8b9a3", "#a99a86"], accent: "#b3282d", floors: [3, 9] },
  },
];
