import type { Spawn } from "@/game/store/game-store";
import { buildFloorplan } from "./floorplan";

/**
 * Office spawn points. The lobby doesn't depend on the org's departments, so the city can use a
 * static entrance spawn: a few metres inside the street doors (south wall), facing into the
 * lobby, with the camera tilted to look in over the wall behind.
 */
const LOBBY_PLAN = buildFloorplan([]);

export const OFFICE_SPAWNS = {
  lobby_entrance: { ...LOBBY_PLAN.spawns.lobby_entrance, pitch: 0.5 },
} satisfies Record<string, Spawn>;
