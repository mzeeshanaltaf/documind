import type { OfficeContext } from "@/game/store/game-store";
import { SAMPLE_DEPARTMENTS } from "@/game/world/office/use-floorplan";
import { roomDepartments } from "@/lib/departments";
import { deriveLocations } from "@/lib/locations";
import type { QuestContext } from "./definitions";

/**
 * What a quest needs to know about the org it is played in (its offices and its departments with
 * a room), derived from the office context. The engine and the journal both call this so their
 * targets agree; the dev sandbox (no org) gets Simtora's departments and no offices.
 */
export function questContext(office: OfficeContext | null, now = ""): QuestContext {
  if (!office) return { offices: [], locations: [], departments: SAMPLE_DEPARTMENTS, location: null, now };
  const locations = deriveLocations(office.org, office.documents);
  return {
    offices: locations.filter((place) => place.role !== "hub").map((place) => place.id),
    locations: locations.map((place) => place.id),
    departments: roomDepartments(office.documents),
    location: office.place.id,
    now,
  };
}
