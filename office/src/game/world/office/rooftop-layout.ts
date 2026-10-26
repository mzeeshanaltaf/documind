import type { Box, Rect, Spot, Vec3 } from "./floorplan";

/**
 * The rooftop lounge as data (phase O9 › Rooftop). Pure, so the scene and the tests read the same
 * plan. The deck is a rectangle centred on the origin (x east, z south); the lift housing is at
 * the south edge and its door faces north, so arriving by lift means walking out onto the deck.
 *
 *     ┌──────────── wall of fame ─────────────┐
 *     │ planter                      telescope│
 *     │  sofa ─ table ─ sofa                  │
 *     │                              fireworks│
 *     │              (spawn)                  │
 *     └──────────────[ lift ]─────────────────┘
 */
export const DECK: Rect = { x: 0, z: 0, w: 22, d: 16 };
const HALF_X = DECK.w / 2;
const HALF_Z = DECK.d / 2;
/** The parapet's visible height; the glass rail above it reaches RAIL_HEIGHT, and the collider all the way. */
export const PARAPET_HEIGHT = 1.1;
export const RAIL_HEIGHT = 2.4;
const WALL = 0.3;
export const LIGHT_HEIGHT = 3.2;

/** Where the lift arrives: in the open south of centre, heading north out over the deck. */
export const ROOFTOP_SPAWN: Spot = { position: [0, 0, HALF_Z - 4.4], yaw: Math.PI };

export type Sofa = { position: Vec3; yaw: number };
export type Planter = { position: Vec3; size: number };

export type RooftopLayout = {
  bounds: Rect;
  /** Where the lift arrives; the heading looks north, out over the deck. */
  spawn: Spot;
  lift: { housing: Box; door: { x: number; z: number; width: number }; call: Vec3 };
  sofas: Sofa[];
  table: Vec3;
  planters: Planter[];
  telescope: Vec3;
  panel: Vec3;
  plaque: { center: Vec3; width: number; height: number; use: Vec3 };
  /** Light posts at the corners; strings hang between them. */
  posts: Vec3[];
  strings: { from: Vec3; to: Vec3; sag: number }[];
  /** Everything solid, as boxes in world space. */
  colliders: Box[];
};

const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number): Box => ({ center: [x, y, z], half: [hx, hy, hz] });

export function rooftopLayout(): RooftopLayout {
  const planters: Planter[] = [
    { position: [-8.6, 0, -7.2], size: 0.8 },
    { position: [-4.4, 0, -7.2], size: 0.8 },
    { position: [4.4, 0, -7.2], size: 0.8 },
    { position: [8.6, 0, -7.2], size: 0.8 },
    { position: [-9.4, 0, 6.9], size: 0.8 },
    { position: [9.4, 0, 6.9], size: 0.8 },
    { position: [-10.2, 0, 0], size: 0.7 },
  ];
  const sofas: Sofa[] = [
    { position: [-7.4, 0, -2.4], yaw: 0 },
    { position: [-7.4, 0, 2.4], yaw: Math.PI },
  ];
  const table: Vec3 = [-7.4, 0, 0];
  const telescope: Vec3 = [8.2, 0, -5.4];
  const panel: Vec3 = [6.4, 0, 3.8];
  const plaque = { center: [0, 1.5, -7.3] as Vec3, width: 5.2, height: 2.2, use: [0, 0, -5.9] as Vec3 };
  const lift = { housing: box(0, 1.6, HALF_Z - 1.2, 1.8, 1.6, 1.2), door: { x: 0, z: HALF_Z - 2.4, width: 1.8 }, call: [0, 0, HALF_Z - 3.4] as Vec3 };

  const edge = 0.2;
  const posts: Vec3[] = [
    [-HALF_X + 0.8, 0, -HALF_Z + 0.8],
    [HALF_X - 0.8, 0, -HALF_Z + 0.8],
    [-HALF_X + 0.8, 0, HALF_Z - 0.8],
    [HALF_X - 0.8, 0, HALF_Z - 0.8],
  ];
  const top = (post: Vec3): Vec3 => [post[0], LIGHT_HEIGHT, post[2]];
  const [nw, ne, sw, se] = posts.map(top);
  const strings = [
    { from: nw, to: ne, sag: 0.7 },
    { from: sw, to: se, sag: 0.7 },
    { from: nw, to: sw, sag: 0.5 },
    { from: ne, to: se, sag: 0.5 },
    { from: [-HALF_X + 0.8, LIGHT_HEIGHT, 0] as Vec3, to: [HALF_X - 0.8, LIGHT_HEIGHT, 0] as Vec3, sag: 1.1 },
  ];

  const colliders: Box[] = [
    // The deck itself and the parapet all round it (tall enough that nobody climbs out).
    box(0, -0.1, 0, HALF_X + WALL, 0.1, HALF_Z + WALL),
    box(0, RAIL_HEIGHT / 2, -HALF_Z - WALL / 2, HALF_X + WALL, RAIL_HEIGHT / 2, WALL / 2),
    box(0, RAIL_HEIGHT / 2, HALF_Z + WALL / 2, HALF_X + WALL, RAIL_HEIGHT / 2, WALL / 2),
    box(-HALF_X - WALL / 2, RAIL_HEIGHT / 2, 0, WALL / 2, RAIL_HEIGHT / 2, HALF_Z),
    box(HALF_X + WALL / 2, RAIL_HEIGHT / 2, 0, WALL / 2, RAIL_HEIGHT / 2, HALF_Z),
    lift.housing,
    ...sofas.map((sofa) => box(sofa.position[0], 0.4, sofa.position[2], 1.0, 0.4, 0.45)),
    box(table[0], 0.25, table[2], 0.7, 0.25, 0.4),
    ...planters.map((planter) => box(planter.position[0], 0.45, planter.position[2], planter.size / 2, 0.45, planter.size / 2)),
    box(telescope[0], 1, telescope[2], 0.3, 1, 0.3),
    box(panel[0], 0.55, panel[2], 0.35, 0.55, 0.35),
    box(plaque.center[0], 1.2, plaque.center[2], plaque.width / 2, 1.2, 0.12),
    ...posts.map((post) => box(post[0], LIGHT_HEIGHT / 2, post[2], edge / 2, LIGHT_HEIGHT / 2, edge / 2)),
  ];

  return {
    bounds: DECK,
    spawn: ROOFTOP_SPAWN,
    lift,
    sofas,
    table,
    planters,
    telescope,
    panel,
    plaque,
    posts,
    strings,
    colliders,
  };
}

/** Whether a disc of `radius` at (x, z) overlaps a solid at standing height (the deck itself, which lies below, doesn't count). */
export function blocked(layout: RooftopLayout, x: number, z: number, radius = 0.3): boolean {
  return layout.colliders.some(({ center, half }) => {
    if (center[1] + half[1] < 0.2) return false;
    return Math.abs(x - center[0]) < half[0] + radius && Math.abs(z - center[2]) < half[2] + radius;
  });
}
