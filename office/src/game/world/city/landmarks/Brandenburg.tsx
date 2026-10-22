import type { CityCollider } from "../generator";
import { box, cone, cylinder, ico, Merged, type Part } from "../merge";
import { Anchored, type LandmarkProps, LocalColliders } from "./common";

/**
 * Berlin: the Brandenburg Gate facing the plaza (two rows of six Doric columns, five passages,
 * the entablature and attic, the patina-green quadriga on top, the low wings), and the
 * Fernsehturm on the horizon beyond.
 */
const SANDSTONE = "#d8ccb0";
const PATINA = "#5f8a78";
const STEEL = "#b9bec0";
const RED = "#b8483e";

const COLUMNS = [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5];
/** The gate is built life-like, then scaled to fit the vista park. */
const SCALE = 0.8;
const WING_X = 17.5;

function gate(): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  add(SANDSTONE, box(30, 0.8, 9.5, { at: [0, 0.4, 0] }));
  for (const x of COLUMNS) {
    for (const z of [-3, 3]) add(SANDSTONE, cylinder(0.75, 0.85, 10.5, 12, { at: [x, 0.8 + 5.25, z] }));
  }
  // The passage walls between the column pairs.
  for (const x of COLUMNS) add(SANDSTONE, box(1.3, 10.5, 5, { at: [x, 0.8 + 5.25, 0] }));
  add(SANDSTONE, box(31, 2.2, 8.8, { at: [0, 12.4, 0] }));
  add(SANDSTONE, box(26, 2.6, 7, { at: [0, 14.8, 0] }));
  add(SANDSTONE, box(10, 1, 5.5, { at: [0, 16.6, 0] }));
  // The quadriga: four horses abreast before a chariot, Victoria standing in it.
  for (const x of [-2.4, -0.8, 0.8, 2.4]) {
    add(PATINA, box(0.7, 1.3, 2.6, { at: [x, 17.75, 1] }));
    add(PATINA, box(0.5, 0.9, 0.8, { at: [x, 18.6, 2.4], rot: [-0.5, 0, 0] }));
    add(PATINA, box(0.18, 1.1, 0.18, { at: [x, 16.9, 0], rot: [0.3, 0, 0] }));
  }
  add(PATINA, box(3, 1.6, 1.6, { at: [0, 17.9, -1] }));
  add(PATINA, cone(0.7, 3.2, 6, { at: [0, 19.6, -1.2] }));
  add(PATINA, box(3.2, 0.25, 0.25, { at: [0, 20.6, -1.2] }));
  // The wings either side.
  for (const x of [-WING_X, WING_X]) {
    add(SANDSTONE, box(5, 7.5, 7.5, { at: [x, 3.75, -0.5] }));
    add(SANDSTONE, box(5.8, 1.2, 8.2, { at: [x, 8, -0.5] }));
  }
  return parts;
}

function tvTower(): Part[] {
  return [
    { color: STEEL, geometry: cylinder(1.4, 3.4, 46, 10, { at: [0, 23, 0] }) },
    { color: STEEL, geometry: ico(5, 1, { at: [0, 49, 0] }) },
    { color: STEEL, geometry: cylinder(1.6, 1.6, 2, 10, { at: [0, 54.5, 0] }) },
    { color: RED, geometry: cylinder(0.5, 0.7, 10, 6, { at: [0, 60.5, 0] }) },
    { color: STEEL, geometry: cylinder(0.28, 0.45, 8, 6, { at: [0, 69.5, 0] }) },
    { color: RED, geometry: cylinder(0.2, 0.28, 3, 6, { at: [0, 75, 0] }) },
  ];
}

const GATE_COLLIDERS: CityCollider[] = [
  ...COLUMNS.map<CityCollider>((x) => ({ kind: "furniture", center: [x, 5.5, 0], half: [0.8, 5.5, 3.6] })),
  { kind: "furniture", center: [-WING_X, 4, -0.5], half: [2.5, 4, 3.75] },
  { kind: "furniture", center: [WING_X, 4, -0.5], half: [2.5, 4, 3.75] },
];

export default function Brandenburg({ site, curb }: LandmarkProps) {
  return (
    <>
      <Anchored at={site.park} yaw={site.yaw}>
        <Merged build={gate} position={[0, curb, 0]} scale={SCALE} />
      </Anchored>
      <Anchored at={site.far} yaw={site.farYaw}>
        <Merged build={tvTower} castShadow={false} materials={{ [STEEL]: { metalness: 0.45, roughness: 0.35 } }} />
      </Anchored>
      <LocalColliders at={site.park} yaw={site.yaw} boxes={GATE_COLLIDERS} scale={SCALE} lift={curb} />
    </>
  );
}
