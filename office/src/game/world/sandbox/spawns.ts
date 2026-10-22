import type { Spawn } from "@/game/store/game-store";

/** Sandbox spawn points (kept apart from the scene so other scenes can link here cheaply). */
export const SANDBOX_SPAWNS = {
  start: { position: [0, 0, 6], yaw: Math.PI },
  lift: { position: [-7, 0, 6.5], yaw: Math.PI * 0.8 },
} satisfies Record<string, Spawn>;
