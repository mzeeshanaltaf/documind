import type { LocationOverride } from "@/lib/locations";
import { SIMTORA_LOCATIONS } from "./simtora";

/** Hand-made office locations per org slug; other orgs get each country's default city. */
export const ORG_LOCATION_OVERRIDES: Record<string, LocationOverride[]> = {
  simtora: SIMTORA_LOCATIONS,
};
