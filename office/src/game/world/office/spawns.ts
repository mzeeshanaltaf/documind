import type { Spawn } from "@/game/store/game-store";
import type { Box } from "@/game/world/city/generator";

/**
 * Office spawn points. Until O5 builds the floor plan, the office is the placeholder room:
 * `lobby_entrance` stands just inside its street doors (south wall), facing into the lobby.
 */
export const OFFICE_SPAWNS = {
  lobby_entrance: { position: [0, 0, 4.8], yaw: Math.PI },
} satisfies Record<string, Spawn>;

/** The placeholder's street doors: walking into this box leaves for the city. */
export const OFFICE_EXIT: Box = { center: [0, 1, 7.6], half: [1.1, 1, 0.45] };
