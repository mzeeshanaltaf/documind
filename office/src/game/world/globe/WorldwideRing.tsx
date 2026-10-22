import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, MeshBasicMaterial } from "three";
import { WORLDWIDE_ID } from "@/lib/locations";
import { useGlobe } from "./globe-store";
import { CLICK_SLOP } from "./Pins";

/**
 * Worldwide: a thin tilted ring around the globe (outside the Earth group, so it doesn't turn
 * with it). Hovering brightens it and marks the list's Worldwide row; clicking chooses it.
 */
export function WorldwideRing({ color, animate, onChoose }: { color: string; animate: boolean; onChoose: (id: string) => void }) {
  const spinner = useRef<Group>(null);
  const material = useRef<MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const { hovered, selected } = useGlobe.getState();
    const active = hovered === WORLDWIDE_ID || selected === WORLDWIDE_ID;
    const dt = Math.min(delta, 0.1);
    if (animate && spinner.current) spinner.current.rotation.z += dt * (selected === WORLDWIDE_ID ? 1.2 : 0.05);
    if (material.current) {
      const goal = active ? 0.95 : 0.4;
      const opacity = material.current.opacity + (goal - material.current.opacity) * (1 - Math.exp(-dt * 10));
      material.current.opacity = opacity;
      if (Math.abs(goal - opacity) > 1e-3) state.invalidate();
    }
  });

  const over = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    document.body.style.cursor = "pointer";
    useGlobe.getState().hover(WORLDWIDE_ID, "globe");
  };
  const out = () => {
    document.body.style.cursor = "";
    useGlobe.getState().hover(null, "globe");
  };
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > CLICK_SLOP) return;
    document.body.style.cursor = "";
    onChoose(WORLDWIDE_ID);
  };

  return (
    <group rotation={[Math.PI / 2 - 0.42, 0, 0.18]}>
      <group ref={spinner}>
        <mesh>
          <torusGeometry args={[1.24, 0.0045, 6, 160]} />
          <meshBasicMaterial ref={material} color={color} transparent opacity={0.4} depthWrite={false} />
        </mesh>
        {/* Small beads, so the ring reads as turning. */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 1.24, Math.sin((i * Math.PI) / 2) * 1.24, 0]}>
            <icosahedronGeometry args={[0.014, 0]} />
            <meshBasicMaterial color={color} />
          </mesh>
        ))}
        <mesh onPointerOver={over} onPointerOut={out} onClick={click}>
          {/* Kept slim: where the ring crosses the globe's face it covers the pins behind it. */}
          <torusGeometry args={[1.24, 0.028, 6, 64]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
