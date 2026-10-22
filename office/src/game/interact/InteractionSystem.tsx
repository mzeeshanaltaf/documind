import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { updateFocus } from "./interact";

/** Ticks per second for picking the focused interactable (frame-rate independent). */
const TICK = 1 / 10;

export function InteractionSystem() {
  const wait = useRef(0);
  useFrame((_, delta) => {
    wait.current -= delta;
    if (wait.current > 0) return;
    wait.current = TICK;
    updateFocus();
  });
  return null;
}
