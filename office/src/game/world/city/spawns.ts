import type { Location } from "@/lib/locations";
import { type CitySpawn, generateCity } from "./generator";
import { hubLayout } from "./hub-layout";

/**
 * Where a location's street scene starts (on the plaza, facing the office doors) and where the
 * player comes back out of the office. Pure, so the location page can compute the first spawn on
 * the server.
 */
export function cityEntrySpawn(place: Location): CitySpawn {
  return place.landmarkKit === "global-hub" ? hubLayout(0).spawn : generateCity(place).spawn;
}

export function cityExitSpawn(place: Location): CitySpawn {
  return place.landmarkKit === "global-hub" ? hubLayout(0).exit : generateCity(place).exit;
}
