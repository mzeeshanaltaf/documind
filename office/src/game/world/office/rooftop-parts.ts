import { beam, box, cone, cylinder, ico, type Part, sphere } from "../city/merge";
import type { Vec3 } from "./floorplan";
import { OFFICE } from "./palette";
import { DECK, LIGHT_HEIGHT, PARAPET_HEIGHT, RAIL_HEIGHT, type RooftopLayout } from "./rooftop-layout";

/**
 * The rooftop's pieces as merged parts (phase O9 › Rooftop): the deck and its parapet, the lift
 * housing, two sofas round a low table, planters, the telescope, the fireworks panel, the wall of
 * fame's frame, light posts with their strings. `matte` is lit, `glow` (bulbs, button, lift
 * lamp) stays bright, `glass` is the rail above the parapet.
 */
export const ROOF = {
  floor: "#cfd2c8",
  tiles: "#bfc3b8",
  deckWood: OFFICE.wood,
  parapet: "#e2e6df",
  cap: "#b9c0b8",
  housing: "#9aa49f",
  leaf: "#aab3af",
  dark: OFFICE.dark,
  fabric: OFFICE.fabric,
  cushion: OFFICE.fabricWarm,
  pot: OFFICE.pot,
  plant: OFFICE.plant,
  plantLight: "#6b9a5a",
  chrome: "#c4cbc7",
  bulb: "#ffe2a8",
  button: "#e0533f",
  frame: "#4a3d31",
};

const RAIL_THICKNESS = 0.04;

/** A point in a piece's own frame (x to its right, z forward) as a world position; `yaw` turns it. */
function local([x, y, z]: Vec3, yaw: number, [dx, dy, dz]: Vec3): Vec3 {
  return [x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, y + dy, z - Math.sin(yaw) * dx + Math.cos(yaw) * dz];
}

/** `aim` is the telescope's heading (0 faces +z) towards the landmark. */
export function rooftopParts(layout: RooftopLayout, aim: number): { matte: Part[]; glow: Part[]; glass: Part[] } {
  const matte: Part[] = [];
  const glow: Part[] = [];
  const glass: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => matte.push({ color, geometry });
  const shine = (color: string, geometry: Part["geometry"]) => glow.push({ color, geometry });
  const halfX = DECK.w / 2;
  const halfZ = DECK.d / 2;

  // The deck, a stone path from the lift, and the wooden lounge platform.
  add(ROOF.floor, box(DECK.w + 0.6, 0.2, DECK.d + 0.6, { at: [0, -0.1, 0] }));
  add(ROOF.tiles, box(2.4, 0.02, DECK.d - 1.2, { at: [0, 0.01, -0.4] }));
  add(ROOF.deckWood, box(5.6, 0.05, 6.6, { at: [layout.table[0], 0.025, layout.table[2]] }));

  // The parapet, its cap, and a glass rail above it.
  const wall = (w: number, d: number, x: number, z: number) => {
    add(ROOF.parapet, box(w, PARAPET_HEIGHT, d, { at: [x, PARAPET_HEIGHT / 2, z] }));
    add(ROOF.cap, box(w + 0.04, 0.06, d + 0.12, { at: [x, PARAPET_HEIGHT + 0.03, z] }));
    glass.push({ color: "#bcd3cc", geometry: box(w, RAIL_HEIGHT - PARAPET_HEIGHT - 0.06, RAIL_THICKNESS, { at: [x, (PARAPET_HEIGHT + RAIL_HEIGHT) / 2 + 0.03, z] }) });
  };
  wall(DECK.w + 0.6, 0.3, 0, -halfZ - 0.15);
  wall(DECK.w + 0.6, 0.3, 0, halfZ + 0.15);
  add(ROOF.parapet, box(0.3, PARAPET_HEIGHT, DECK.d, { at: [-halfX - 0.15, PARAPET_HEIGHT / 2, 0] }));
  add(ROOF.parapet, box(0.3, PARAPET_HEIGHT, DECK.d, { at: [halfX + 0.15, PARAPET_HEIGHT / 2, 0] }));
  add(ROOF.cap, box(0.42, 0.06, DECK.d, { at: [-halfX - 0.15, PARAPET_HEIGHT + 0.03, 0] }));
  add(ROOF.cap, box(0.42, 0.06, DECK.d, { at: [halfX + 0.15, PARAPET_HEIGHT + 0.03, 0] }));
  for (const x of [-halfX - 0.15, halfX + 0.15]) {
    glass.push({ color: "#bcd3cc", geometry: box(RAIL_THICKNESS, RAIL_HEIGHT - PARAPET_HEIGHT - 0.06, DECK.d, { at: [x, (PARAPET_HEIGHT + RAIL_HEIGHT) / 2 + 0.03, 0] }) });
  }

  // The lift housing against the south wall: two brushed leaves, a lamp over the door.
  const { housing, door } = layout.lift;
  add(ROOF.housing, box(housing.half[0] * 2, housing.half[1] * 2, housing.half[2] * 2, { at: housing.center }));
  add(ROOF.cap, box(housing.half[0] * 2 + 0.2, 0.12, housing.half[2] * 2 + 0.2, { at: [housing.center[0], housing.half[1] * 2 + 0.06, housing.center[2]] }));
  for (const side of [-1, 1]) add(ROOF.leaf, box(door.width / 2 - 0.02, 2.4, 0.06, { at: [(side * door.width) / 4, 1.2, door.z - 0.03] }));
  shine("#7be0a7", box(0.4, 0.08, 0.04, { at: [0, 2.65, door.z - 0.04] }));

  // Sofas round the table: seat, back, two arms and a cushion each; the back is away from the table.
  for (const { position, yaw } of layout.sofas) {
    const at = (p: Vec3) => local(position, yaw, p);
    const rot: [number, number, number] = [0, yaw, 0];
    add(ROOF.fabric, box(2.0, 0.4, 0.9, { at: at([0, 0.2, 0]), rot }));
    add(ROOF.fabric, box(2.0, 0.55, 0.2, { at: at([0, 0.65, -0.35]), rot }));
    add(ROOF.fabric, box(0.18, 0.3, 0.9, { at: at([-0.91, 0.55, 0]), rot }));
    add(ROOF.fabric, box(0.18, 0.3, 0.9, { at: at([0.91, 0.55, 0]), rot }));
    add(ROOF.cushion, box(0.5, 0.18, 0.42, { at: at([0.55, 0.5, 0.05]), rot: [0, yaw, 0.12] }));
  }
  const [tx, , tz] = layout.table;
  add(ROOF.deckWood, box(1.4, 0.07, 0.8, { at: [tx, 0.4, tz] }));
  for (const [dx, dz] of [[-0.6, -0.32], [0.6, -0.32], [-0.6, 0.32], [0.6, 0.32]]) add(ROOF.dark, box(0.06, 0.4, 0.06, { at: [tx + dx, 0.2, tz + dz] }));
  add(ROOF.pot, cylinder(0.12, 0.1, 0.12, 10, { at: [tx + 0.2, 0.5, tz] }));

  // Planters with foliage (a ball and a smaller one on top), placed by size.
  layout.planters.forEach(({ position: [px, , pz], size }, index) => {
    add(ROOF.pot, box(size, 0.9, size, { at: [px, 0.45, pz] }));
    add(ROOF.cap, box(size + 0.06, 0.06, size + 0.06, { at: [px, 0.93, pz] }));
    add(index % 2 === 0 ? ROOF.plant : ROOF.plantLight, ico(size * 0.62, 1, { at: [px, 1.35, pz] }));
    add(ROOF.plantLight, ico(size * 0.38, 1, { at: [px + size * 0.18, 1.8, pz - size * 0.1] }));
    if (index % 3 === 0) add(ROOF.plant, cone(size * 0.32, 1.1, 7, { at: [px - size * 0.25, 2.0, pz + size * 0.12] }));
  });

  // The telescope: a tripod, a tube turned towards the landmark (aim) and an eyepiece.
  const [sx, , sz] = layout.telescope;
  const hinge: Vec3 = [sx, 1.35, sz];
  for (let leg = 0; leg < 3; leg++) {
    const angle = (leg / 3) * Math.PI * 2 + 0.5;
    add(ROOF.dark, beam([sx + Math.sin(angle) * 0.45, 0, sz + Math.cos(angle) * 0.45], [sx, 1.3, sz], 0.05));
  }
  add(ROOF.chrome, cylinder(0.07, 0.07, 0.15, 10, { at: hinge }));
  const tube = (distance: number): Vec3 => [sx + Math.sin(aim) * distance, 1.5 + distance * 0.1, sz + Math.cos(aim) * distance];
  add(ROOF.dark, beam(tube(-0.15), tube(0.9), 0.14));
  add(ROOF.chrome, beam(tube(0.55), tube(0.95), 0.18));
  add(ROOF.chrome, sphere(0.06, 8, 6, { at: tube(-0.2) }));

  // The fireworks panel: a pedestal with a tilted top and a big button.
  const [px, , pz] = layout.panel;
  add(ROOF.dark, box(0.6, 1.0, 0.6, { at: [px, 0.5, pz] }));
  add(ROOF.chrome, box(0.66, 0.06, 0.66, { at: [px, 1.03, pz] }));
  shine(ROOF.button, cylinder(0.12, 0.13, 0.08, 14, { at: [px, 1.1, pz] }));
  for (const dx of [-0.2, 0.2]) shine("#7be0a7", sphere(0.025, 6, 4, { at: [px + dx, 1.08, pz + 0.22] }));

  // The wall of fame: a frame and two posts (the face itself is a texture).
  const { center, width, height } = layout.plaque;
  add(ROOF.frame, box(width + 0.24, height + 0.24, 0.12, { at: center }));
  for (const side of [-1, 1]) add(ROOF.frame, box(0.14, 2.7, 0.14, { at: [center[0] + (side * width) / 2, 1.35, center[2]] }));

  // Light posts and the strings between them: a sagging run of small bulbs.
  for (const [x, , z] of layout.posts) {
    add(ROOF.dark, cylinder(0.05, 0.06, LIGHT_HEIGHT, 8, { at: [x, LIGHT_HEIGHT / 2, z] }));
    add(ROOF.dark, cylinder(0.14, 0.16, 0.08, 10, { at: [x, 0.04, z] }));
  }
  for (const { from, to, sag } of layout.strings) {
    const steps = Math.max(4, Math.round(Math.hypot(to[0] - from[0], to[2] - from[2]) / 0.9));
    const point = (k: number): Vec3 => {
      const t = k / steps;
      return [from[0] + (to[0] - from[0]) * t, from[1] - sag * 4 * t * (1 - t), from[2] + (to[2] - from[2]) * t];
    };
    for (let k = 0; k < steps; k++) {
      add(ROOF.dark, beam(point(k), point(k + 1), 0.015));
      const [bx, by, bz] = point(k);
      shine(ROOF.bulb, ico(0.075, 0, { at: [bx, by - 0.08, bz] }));
    }
  }

  return { matte, glow, glass };
}
