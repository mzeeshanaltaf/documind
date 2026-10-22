import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { beam, box, ico, Merged, type Part } from "../merge";
import { Anchored, type LandmarkProps, LocalColliders, Water } from "./common";

/**
 * San Francisco: a suspension bridge in International Orange across the bay beyond the vista
 * park, headlands behind it, and a cable car shuttling on a short track in the park.
 */
const ORANGE = "#c0462f";
const HILLS = "#7d8a5c";
const PIER = "#b9b3a6";

const TOWER_X = 55;
const TOP = 52;
const DECK = 21;

function cableHeight(x: number) {
  const ax = Math.abs(x);
  if (ax <= TOWER_X) return DECK + 1.5 + (TOP - DECK - 1.5) * (ax / TOWER_X) ** 2;
  const u = (ax - TOWER_X) / 45;
  return TOP + (DECK + 1 - TOP) * u - 5 * Math.sin(Math.PI * u);
}

function bridge(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  add(ORANGE, box(200, 1.8, 9, { at: [0, DECK - 1, 0] }));
  add(ORANGE, box(200, 1.4, 7, { at: [0, DECK - 2.5, 0] }));
  for (const tx of [-TOWER_X, TOWER_X]) {
    add(PIER, box(9, 5, 14, { at: [tx, 0.5, 0] }));
    for (const z of [-4.2, 4.2]) add(ORANGE, box(2.6, TOP + 2, 2.6, { at: [tx, (TOP + 2) / 2, z] }));
    for (const y of [DECK + 8, DECK + 18, DECK + 26, TOP]) add(ORANGE, box(2.2, 2.4, 8.4, { at: [tx, y, 0] }));
  }
  for (const z of [-4.2, 4.2]) {
    // Main cables: a parabola between the towers, a sagging run down to each anchorage.
    const steps = 28;
    for (let k = 0; k < steps; k++) {
      const x0 = -100 + (200 * k) / steps;
      const x1 = -100 + (200 * (k + 1)) / steps;
      add(ORANGE, beam([x0, cableHeight(x0), z], [x1, cableHeight(x1), z], 0.7));
    }
    for (let x = -TOWER_X + 6; x < TOWER_X - 3; x += 6.5) add(ORANGE, beam([x, DECK, z], [x, cableHeight(x), z], 0.2));
  }
  // The headlands either side, behind the bridge.
  add(HILLS, ico(34, 1, { at: [-128, -8, -36], scale: [1.5, 0.55, 1] }));
  add(HILLS, ico(30, 1, { at: [132, -8, -30], scale: [1.3, 0.5, 1] }));
  return parts;
}

const CAR_RED = "#b23a2e";
const CREAM = "#efe3c4";
const DARK = "#2b2f31";

function cableCar(): Part[] {
  return [
    { color: CAR_RED, geometry: box(5.4, 1.3, 2.4, { at: [0, 0.95, 0] }) },
    { color: CREAM, geometry: box(5.45, 0.85, 2.45, { at: [0, 1.95, 0] }) },
    { color: DARK, geometry: box(4.4, 0.6, 2.5, { at: [0, 1.98, 0] }) },
    { color: CAR_RED, geometry: box(5.9, 0.24, 2.7, { at: [0, 2.5, 0] }) },
    { color: DARK, geometry: box(5, 0.3, 1.8, { at: [0, 0.2, 0] }) },
  ];
}

function track(): Part[] {
  return [
    { color: DARK, geometry: box(26, 0.08, 0.12, { at: [0, 0.04, -0.72] }) },
    { color: DARK, geometry: box(26, 0.08, 0.12, { at: [0, 0.04, 0.72] }) },
  ];
}

export default function GoldenGate({ site, vista, curb }: LandmarkProps) {
  const car = useRef<Group>(null);
  useFrame(({ clock }) => {
    // Up and down the track, easing into each end.
    car.current?.position.setX(Math.sin(clock.elapsedTime * 0.22) * 9.5);
  });

  return (
    <>
      <Water rects={vista} />
      <Anchored at={site.far} yaw={site.farYaw}>
        <Merged build={bridge} castShadow={false} />
      </Anchored>
      <Anchored at={site.park} yaw={site.yaw}>
        <group position={[0, curb + 0.02, 4]}>
          <Merged build={track} castShadow={false} />
          <group ref={car}>
            <Merged build={cableCar} />
          </group>
        </group>
      </Anchored>
      <LocalColliders at={site.park} yaw={site.yaw} boxes={[{ kind: "furniture", center: [0, 1.4, 4], half: [13, 1.4, 1.3] }]} lift={curb} />
    </>
  );
}
