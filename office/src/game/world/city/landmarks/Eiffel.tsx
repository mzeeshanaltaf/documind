import type { CityCollider, Rect } from "../generator";
import { beam, box, cylinder, Merged, type Part, torus } from "../merge";
import { Colliders } from "../Ground";
import { Anchored, type LandmarkProps, LocalColliders } from "./common";

/**
 * Paris: the tower in the vista park (four splayed legs with arches between them, two
 * platforms, the tapering shaft and its lattice bracing) and, in the office garden, a café
 * terrace under red-and-white striped awnings.
 */
const IRON = "#6e5b47";
const CREAM = "#efe6d2";
const AWNING_RED = "#b8463a";
const AWNING_WHITE = "#f4f0e6";
const METAL = "#2f3433";

type V = [number, number, number];
const corners = (r: number, y: number): V[] => [
  [r, y, r],
  [-r, y, r],
  [-r, y, -r],
  [r, y, -r],
];

function tower(): Part[] {
  const parts: Part[] = [];
  const add = (geometry: Part["geometry"]) => parts.push({ color: IRON, geometry });
  const levels: [number, number, number][] = [
    [8.6, 0, 2.3],
    [3.5, 13, 1.7],
    [1.9, 24, 1.1],
    [0.45, 38, 0.5],
  ];
  for (let level = 0; level < levels.length - 1; level++) {
    const [r0, y0, w] = levels[level];
    const [r1, y1] = levels[level + 1];
    const bottom = corners(r0, y0);
    const top = corners(r1, y1);
    for (let k = 0; k < 4; k++) {
      add(beam(bottom[k], top[k], w));
      // Lattice: an X across each face between this level's legs.
      const next = (k + 1) % 4;
      if (level > 0) {
        add(beam(bottom[k], top[next], 0.22));
        add(beam(bottom[next], top[k], 0.22));
      }
    }
  }
  // Arches between the legs, one per face.
  for (let k = 0; k < 4; k++) {
    const angle = (k * Math.PI) / 2;
    add(torus(5.4, 0.42, 5, 14, Math.PI, { at: [Math.sin(angle) * 6.6, 2.2, Math.cos(angle) * 6.6], rot: [0, angle, 0] }));
  }
  add(box(12.6, 1, 12.6, { at: [0, 13.2, 0] }));
  add(box(6.6, 0.8, 6.6, { at: [0, 24.2, 0] }));
  add(box(1.8, 2, 1.8, { at: [0, 38.8, 0] }));
  add(cylinder(0.15, 0.3, 4, 6, { at: [0, 41.6, 0] }));
  return parts;
}

/** Where the café stands: against the garden's east side, its terrace facing the plaza. */
function cafeSpot(garden: Rect) {
  const back = garden.x + garden.w / 2 - 0.4;
  const z = garden.z - 0.5;
  const tables: [number, number][] = [
    [back - 3.4, z - 2],
    [back - 3.4, z + 1.4],
    [back - 5.6, z - 0.4],
    [back - 5.6, z + 2.8],
  ];
  return { x: back - 1.8, z, tables };
}

function cafeParts(garden: Rect, curb: number, accent: string): Part[] {
  const { x, z, tables } = cafeSpot(garden);
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  add(CREAM, box(3.6, 3.2, 6.4, { at: [x, curb + 1.6, z] }));
  add(accent, box(3.8, 0.5, 6.6, { at: [x, curb + 3.4, z] }));
  add(accent, box(0.12, 2.1, 6.2, { at: [x - 1.82, curb + 1.25, z] }));
  // A striped awning sloping out over the terrace.
  const stripes = 12;
  for (let k = 0; k < stripes; k++) {
    const sz = z - 3.2 + (6.4 * (k + 0.5)) / stripes;
    add(k % 2 ? AWNING_WHITE : AWNING_RED, box(2.4, 0.06, 6.4 / stripes, { at: [x - 2.9, curb + 2.75, sz], rot: [0, 0, 0.32] }));
  }
  for (const [tx, tz] of tables) {
    add(METAL, cylinder(0.05, 0.05, 0.72, 5, { at: [tx, curb + 0.36, tz] }));
    add(CREAM, cylinder(0.42, 0.42, 0.05, 10, { at: [tx, curb + 0.74, tz] }));
    for (const side of [-0.7, 0.7]) {
      add(METAL, box(0.4, 0.05, 0.4, { at: [tx, curb + 0.45, tz + side] }));
      add(METAL, box(0.4, 0.45, 0.05, { at: [tx, curb + 0.7, tz + side + Math.sign(side) * 0.2] }));
    }
  }
  return parts;
}

function cafeColliders(garden: Rect, curb: number): CityCollider[] {
  const { x, z, tables } = cafeSpot(garden);
  return [
    { kind: "furniture", center: [x, curb + 1.6, z], half: [1.8, 1.6, 3.2] },
    ...tables.map<CityCollider>(([tx, tz]) => ({ kind: "furniture", center: [tx, curb + 0.4, tz], half: [0.45, 0.4, 1.1] })),
  ];
}

const LEG_COLLIDERS: CityCollider[] = corners(7.6, 2).map((center) => ({ kind: "furniture", center, half: [1.4, 2, 1.4] }));

export default function Eiffel({ site, garden, curb, accent }: LandmarkProps) {
  return (
    <>
      <Anchored at={site.park} yaw={site.yaw}>
        <Merged build={tower} position={[0, curb, 0]} roughness={0.7} materials={{ [IRON]: { metalness: 0.4 } }} />
      </Anchored>
      <Merged build={() => cafeParts(garden, curb, accent)} version={`${garden.x}|${garden.z}|${curb}|${accent}`} />
      <LocalColliders at={site.park} yaw={site.yaw} boxes={LEG_COLLIDERS} lift={curb} />
      <Colliders colliders={cafeColliders(garden, curb)} />
    </>
  );
}
