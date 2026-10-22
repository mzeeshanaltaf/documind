import { GENERIC_PALETTE, type Location } from "@/lib/locations";

/** The city the dev sandbox's lift goes to (it has no org or office location). */
export const SAMPLE_CITY: Location = {
  id: "sample-city",
  name: "Sample City",
  country: null,
  role: "office",
  roleLabel: "Office",
  lat: 51.5,
  lon: -0.12,
  timezone: "Europe/London",
  landmarkKit: "generic",
  palette: GENERIC_PALETTE,
  docCodes: [],
};
