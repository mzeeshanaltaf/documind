import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { rig } from "@/game/player/rig";

/**
 * True while the player is within `range` of (x, z), with 2 m of hysteresis. Checked at 4 Hz, so
 * rooms mount their visuals (and NPCs) only when someone could see them.
 */
export function useNear(x: number, z: number, range: number): boolean {
  const [near, setNear] = useState(false);
  const state = useRef({ near: false, wait: 0 });
  useFrame((_, delta) => {
    const s = state.current;
    s.wait -= delta;
    if (s.wait > 0) return;
    s.wait = 0.25;
    const distance = Math.hypot(rig.position.x - x, rig.position.z - z);
    const next = s.near ? distance < range + 2 : distance < range;
    if (next !== s.near) {
      s.near = next;
      setNear(next);
    }
  });
  return near;
}
