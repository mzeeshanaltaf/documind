import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { rig } from "@/game/player/rig";
import { useGame } from "@/game/store/game-store";
import { type Box, insideBox } from "./city/generator";

/**
 * Calls `onEnter` when the player's feet walk into the box (doorways between scenes). A plain
 * per-frame point-in-box test rather than a physics sensor: the player is a kinematic body,
 * and kinematic-fixed pairs raise no intersection events by default. It only fires on the way
 * in, while the scene is ready and no dialog is open, so spawning inside never triggers it.
 */
export function Trigger({ box, onEnter }: { box: Box; onEnter: () => void }) {
  const inside = useRef<boolean | null>(null);
  const handler = useRef(onEnter);
  useEffect(() => {
    handler.current = onEnter;
  });

  useFrame(() => {
    const state = useGame.getState();
    const now = insideBox(rig.position, box);
    const was = inside.current;
    inside.current = now;
    if (was === false && now && state.world.phase === "ready" && !state.modal) handler.current();
  });
  return null;
}
