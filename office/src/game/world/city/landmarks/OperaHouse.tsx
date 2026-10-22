import type { CityCollider } from "../generator";
import { ConeGeometry } from "three";
import { beam, box, Merged, type Part, place, torus } from "../merge";
import { Anchored, type LandmarkProps, LocalColliders, Water } from "./common";

/**
 * Sydney: the Opera House's tiled sail shells (two rows of nested shells plus the restaurant's
 * small pair) on their sandstone podium in the vista park, and the Harbour Bridge's steel arch
 * across the harbour beyond it.
 */
const SHELL = "#f2f0e8";
const PODIUM = "#cdbb98";
const STEEL = "#7d868b";
const GRANITE = "#c9bfae";

/**
 * One sail: an open slice of a cone (a curved, pointed shell) standing on its arc, its convex
 * face turned to `facing` (radians about y) and its tip leaning back by `lean`. Drawn from both
 * sides, since you see into the open shells from behind.
 */
function shell(size: number, at: [number, number, number], facing: number, lean: number) {
  const cone = new ConeGeometry(size * 0.62, size, 10, 1, true, -0.9, 1.8).translate(0, size / 2, 0);
  return place(cone, { at, rot: [-lean, facing, 0], order: "YXZ" });
}

function operaHouse(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  add(PODIUM, box(14, 2.4, 30, { at: [0, 1.2, -2] }));
  add(PODIUM, box(18, 1.2, 8, { at: [0, 0.6, 15] }));
  // Two halls side by side, each a row of shells shrinking towards the plaza (+z).
  for (const hx of [-3.4, 3.4]) {
    const sizes = [15, 12.5, 10, 7.5];
    sizes.forEach((size, k) => add(SHELL, shell(size, [hx, 2.4, -9 + k * 5.4], 0, 0.42 - k * 0.04)));
    add(SHELL, shell(7, [hx, 2.4, -13], Math.PI, 0.35));
  }
  // The restaurant's small pair at the front.
  add(SHELL, shell(6, [0, 1.2, 12], 0, 0.4));
  add(SHELL, shell(4.5, [0, 1.2, 15], Math.PI, 0.35));
  return parts;
}

function harbourBridge(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  const span = 58;
  const deck = 15;
  // The arch: two ribs (flattened half-torus), braced together, the deck hung beneath.
  for (const z of [-4, 4]) {
    add(STEEL, torus(span, 1.5, 4, 28, Math.PI, { at: [0, 4, z], scale: [1, 0.62, 1] }));
    add(STEEL, torus(span - 3, 0.8, 4, 28, Math.PI, { at: [0, 4, z], scale: [1, 0.6, 1] }));
  }
  for (let x = -span + 8; x <= span - 8; x += 6) {
    const archY = 4 + Math.sqrt(Math.max(0, span * span - x * x)) * 0.62;
    if (archY > deck + 1) for (const z of [-4, 4]) add(STEEL, beam([x, deck, z], [x, archY, z], 0.25));
    add(STEEL, beam([x, archY, -4], [x, archY, 4], 0.4));
  }
  add(STEEL, box(190, 1.6, 10, { at: [0, deck, 0] }));
  for (const x of [-span - 4, span + 4]) {
    add(GRANITE, box(9, 26, 12, { at: [x, 13, 0] }));
    add(GRANITE, box(7, 4, 10, { at: [x, 28, 0] }));
  }
  for (const x of [-80, -70, 70, 80]) add(GRANITE, box(3, deck, 8, { at: [x, deck / 2, 0] }));
  return parts;
}

const PODIUM_COLLIDERS: CityCollider[] = [
  { kind: "furniture", center: [0, 1.2, -2], half: [7, 1.2, 15] },
  { kind: "furniture", center: [0, 0.6, 15], half: [9, 0.6, 4] },
];

export default function OperaHouse({ site, vista, curb }: LandmarkProps) {
  return (
    <>
      <Water rects={vista} />
      <Anchored at={site.park} yaw={site.yaw + Math.PI * 0.18}>
        <Merged build={operaHouse} position={[0, curb, 0]} scale={0.85} roughness={0.55} materials={{ [SHELL]: { doubleSided: true } }} />
      </Anchored>
      <Anchored at={site.far} yaw={site.farYaw}>
        <Merged build={harbourBridge} castShadow={false} materials={{ [STEEL]: { metalness: 0.4, roughness: 0.45 } }} />
      </Anchored>
      <LocalColliders at={site.park} yaw={site.yaw + Math.PI * 0.18} boxes={PODIUM_COLLIDERS} scale={0.85} lift={curb} />
    </>
  );
}
