import type { LandmarkKit, Location, Palette } from "@/lib/locations";
import { type Loop, roundedSquareLoop } from "./paths";
import { hashString, int, mulberry32, pick, type Random, range } from "./random";

/**
 * The city generator (phase O4 › 1): a 3×3 street grid round the org's office, laid out from a
 * seeded PRNG so a location always builds the same city. Pure data, no three.js; the scene
 * components render it, and Vitest checks it.
 *
 * Axes: x east, z south (so north is −z), y up; metres. The central block holds the office
 * (entrance facing south) and its plaza, the north-east block is the vista park where the
 * landmark stands, and the sector beyond that corner stays clear of skyline so the landmark (and
 * any bay or harbour it brings) reads from the plaza.
 */

export type Vec3 = [number, number, number];
/** An axis-aligned rectangle on the ground: centre and size along x (w) and z (d). */
export type Rect = { x: number; z: number; w: number; d: number };
export type Box = { center: Vec3; half: Vec3 };
export type CitySpawn = { position: Vec3; yaw: number; pitch?: number };

export const CITY = {
  block: 32,
  road: 10,
  /** Block centre to block centre. */
  pitch: 42,
  /** Pavement ring inside each block's curb. */
  pavement: 3.5,
  /** Pavements and blocks sit this high above the road. */
  curb: 0.12,
  groundFloor: 4.2,
  floorHeight: 3.2,
  /** Outer edge of the ring road; the boundary walls stand just outside it. */
  half: 68,
  /** Lane centre from the road's centre line. */
  lane: 2.5,
  /** Pedestrian paths run this far inside the curb. */
  walkInset: 2.2,
} as const;

export type BlockKind = "office" | "buildings" | "park" | "vista";
export type CityBlock = { i: number; j: number; kind: BlockKind; rect: Rect };

export type Face = "east" | "west" | "south" | "north";
export type CityBuilding = {
  id: string;
  rect: Rect;
  floors: number;
  height: number;
  color: string;
  /** Facades that carry windows (skyline towers only show the city their inner faces). */
  faces: Face[];
};

export type FurnitureKind = "lamp" | "tree" | "bench" | "bin";
export type Furniture = { kind: FurnitureKind; x: number; z: number; yaw: number; scale: number };

export type WalkNodeKind = "pavement" | "plaza" | "spawn" | "entrance";
export type WalkNode = { id: number; x: number; z: number; kind: WalkNodeKind };
export type WalkGraph = { nodes: WalkNode[]; edges: [number, number][]; neighbours: number[][] };

/** A zebra crossing: its centre, and the axis pedestrians walk along to cross. */
export type Crossing = { x: number; z: number; across: "x" | "z" };

export type ColliderKind = "ground" | "block" | "building" | "office" | "plaza-edge" | "furniture" | "boundary";
/** A fixed box collider; `yaw` turns it about y (the Global Hub's railing ring). */
export type CityCollider = Box & { kind: ColliderKind; yaw?: number };

export type OfficeSite = {
  rect: Rect;
  height: number;
  /** The glazed lobby storey(s) at the foot of the tower. */
  podium: number;
  /** Centre of the doorway on the facade; the doors face south (yaw 0). */
  door: { x: number; z: number; yaw: number; width: number };
  /** The doors sit in a recess this deep; the entrance trigger is inside it. */
  vestibule: number;
};

export type Window = { x: number; y: number; z: number; yaw: number; lit: number };

export type CityLayout = {
  seed: number;
  kit: LandmarkKit;
  palette: Palette;
  driveOnLeft: boolean;
  blocks: CityBlock[];
  roads: Rect[];
  crossings: Crossing[];
  plaza: Rect;
  /** Low stone seat walls along the plaza's sides. */
  ledges: Rect[];
  /** The lawn east of the office (Paris puts its café there). */
  garden: Rect;
  buildings: CityBuilding[];
  /** The towers round the edge, beyond the boundary: scenery, no colliders. */
  skyline: CityBuilding[];
  furniture: Furniture[];
  loops: Loop[];
  walk: WalkGraph;
  office: OfficeSite;
  spawn: CitySpawn;
  /** Where the player comes back out of the office. */
  exit: CitySpawn;
  /** Walking into this box enters the office. */
  entrance: Box;
  landmark: { park: { x: number; z: number }; far: { x: number; z: number }; yaw: number; farYaw: number };
  /** The vista sector beyond the north-east corner (no skyline; bay kits fill it with water). */
  vista: Rect[];
  colliders: CityCollider[];
};

/** Countries that drive on the left (lanes and loop directions mirror). */
const DRIVE_ON_LEFT = new Set([
  "GB", "IE", "AU", "NZ", "PK", "IN", "BD", "LK", "NP", "JP", "SG", "MY", "HK", "TH", "ID", "ZA", "KE", "UG", "TZ", "CY", "MT", "JM",
]);

const VISTA_CELL = { i: 2, j: 0 };
const OFFICE_CELL = { i: 1, j: 1 };

const cellCentre = (index: number) => (index - 1) * CITY.pitch;

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + margin * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d + margin * 2;
}

/** True when `inner` lies entirely inside `outer`. */
export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x - inner.w / 2 >= outer.x - outer.w / 2 - 1e-9 &&
    inner.x + inner.w / 2 <= outer.x + outer.w / 2 + 1e-9 &&
    inner.z - inner.d / 2 >= outer.z - outer.d / 2 - 1e-9 &&
    inner.z + inner.d / 2 <= outer.z + outer.d / 2 + 1e-9
  );
}

const fromBounds = (x0: number, x1: number, z0: number, z1: number): Rect => ({
  x: (x0 + x1) / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  d: z1 - z0,
});

const inset = (rect: Rect, by: number): Rect => ({ x: rect.x, z: rect.z, w: rect.w - by * 2, d: rect.d - by * 2 });

function roads(): Rect[] {
  const length = CITY.half * 2;
  const centres = [-1.5, -0.5, 0.5, 1.5].map((k) => k * CITY.pitch);
  return [
    ...centres.map((x) => ({ x, z: 0, w: CITY.road, d: length })),
    ...centres.map((z) => ({ x: 0, z, w: length, d: CITY.road })),
  ];
}

function buildingHeight(floors: number) {
  return CITY.groundFloor + (floors - 1) * CITY.floorHeight;
}

/** Splits a block's buildable area into one, two or four lots, with alleys between. */
function lots(area: Rect, random: Random): Rect[] {
  const alley = 1.2;
  const split = random();
  const x0 = area.x - area.w / 2;
  const z0 = area.z - area.d / 2;
  const halfW = (area.w - alley) / 2;
  const halfD = (area.d - alley) / 2;
  if (split < 0.12) return [area];
  if (split < 0.34) {
    return [fromBounds(x0, x0 + halfW, z0, z0 + area.d), fromBounds(x0 + halfW + alley, x0 + area.w, z0, z0 + area.d)];
  }
  if (split < 0.56) {
    return [fromBounds(x0, x0 + area.w, z0, z0 + halfD), fromBounds(x0, x0 + area.w, z0 + halfD + alley, z0 + area.d)];
  }
  const result: Rect[] = [];
  for (const [ix, iz] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const lx = x0 + ix * (halfW + alley);
    const lz = z0 + iz * (halfD + alley);
    result.push(fromBounds(lx, lx + halfW, lz, lz + halfD));
  }
  return result;
}

/** A footprint inside a lot: set back a little, by a random amount per side. */
function footprint(lot: Rect, random: Random): Rect {
  const x0 = lot.x - lot.w / 2 + range(random, 0.4, 1.4);
  const x1 = lot.x + lot.w / 2 - range(random, 0.4, 1.4);
  const z0 = lot.z - lot.d / 2 + range(random, 0.4, 1.4);
  const z1 = lot.z + lot.d / 2 - range(random, 0.4, 1.4);
  return fromBounds(x0, x1, z0, z1);
}

const ALL_FACES: Face[] = ["east", "west", "south", "north"];

export function generateCity(location: Location, seed = hashString(location.id)): CityLayout {
  const random = mulberry32(seed);
  const palette = location.palette;
  const [minFloors, maxFloors] = palette.floors;
  const driveOnLeft = location.country !== null && DRIVE_ON_LEFT.has(location.country);

  // Blocks: office in the middle, the vista park north-east, one more park somewhere else.
  const others: { i: number; j: number }[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const special = (i === OFFICE_CELL.i && j === OFFICE_CELL.j) || (i === VISTA_CELL.i && j === VISTA_CELL.j);
      if (!special) others.push({ i, j });
    }
  }
  const park = pick(random, others);
  const blocks: CityBlock[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const kind: BlockKind =
        i === OFFICE_CELL.i && j === OFFICE_CELL.j
          ? "office"
          : i === VISTA_CELL.i && j === VISTA_CELL.j
            ? "vista"
            : i === park.i && j === park.j
              ? "park"
              : "buildings";
      blocks.push({ i, j, kind, rect: { x: cellCentre(i), z: cellCentre(j), w: CITY.block, d: CITY.block } });
    }
  }

  // The office: the north-west of the central block, entrance facing the plaza to the south.
  const centre = inset(blocks[4].rect, CITY.pavement);
  const officeRect = fromBounds(-11, 3, centre.z - centre.d / 2, 0);
  const office: OfficeSite = {
    rect: officeRect,
    podium: 7.4,
    height: 7.4 + 9 * 3.4,
    door: { x: officeRect.x, z: 0, yaw: 0, width: 2.6 },
    vestibule: 1.6,
  };
  const plaza = fromBounds(centre.x - centre.w / 2, centre.x + centre.w / 2, 0, centre.z + centre.d / 2);
  const garden = fromBounds(officeRect.x + officeRect.w / 2, centre.x + centre.w / 2, centre.z - centre.d / 2, 0);
  const ledges: Rect[] = [fromBounds(-12.3, -11.7, 1.5, 10.5), fromBounds(11.7, 12.3, 1.5, 10.5)];

  // Buildings on the ordinary blocks.
  const buildings: CityBuilding[] = [];
  for (const block of blocks) {
    if (block.kind !== "buildings") continue;
    for (const lot of lots(inset(block.rect, CITY.pavement), random)) {
      const floors = int(random, minFloors, maxFloors);
      buildings.push({
        id: `b${block.i}${block.j}-${buildings.length}`,
        rect: footprint(lot, random),
        floors,
        height: buildingHeight(floors),
        color: pick(random, palette.buildings),
        faces: ALL_FACES,
      });
    }
  }

  // The vista sector: beyond the north-east, kept open to the horizon.
  const vista: Rect[] = [fromBounds(-10, 260, -260, -72), fromBounds(72, 260, -72, 10)];

  // Skyline: a ring of taller towers outside the boundary, facing the city.
  const skyline: CityBuilding[] = [];
  for (let gz = -120; gz <= 120; gz += 16) {
    for (let gx = -120; gx <= 120; gx += 16) {
      if (Math.max(Math.abs(gx), Math.abs(gz)) < 80) continue;
      const rect: Rect = { x: gx + range(random, -1.5, 1.5), z: gz + range(random, -1.5, 1.5), w: range(random, 9, 13.5), d: range(random, 9, 13.5) };
      if (vista.some((sector) => rectsOverlap(rect, sector, 4))) continue;
      if (random() < 0.28) continue;
      const floors = int(random, maxFloors, maxFloors + 7);
      const faces: Face[] = [];
      if (Math.abs(gx) >= 80) faces.push(gx > 0 ? "west" : "east");
      if (Math.abs(gz) >= 80) faces.push(gz > 0 ? "north" : "south");
      skyline.push({ id: `s${skyline.length}`, rect, floors, height: buildingHeight(floors), color: pick(random, palette.buildings), faces });
    }
  }

  // Street furniture: lamps and trees along every curb, bins by some lamps.
  const furniture: Furniture[] = [];
  const edge = CITY.block / 2 - 0.7;
  for (const block of blocks) {
    const { x: cx, z: cz } = block.rect;
    const sides = [
      { nx: 0, nz: -1, yaw: Math.PI },
      { nx: 0, nz: 1, yaw: 0 },
      { nx: 1, nz: 0, yaw: Math.PI / 2 },
      { nx: -1, nz: 0, yaw: -Math.PI / 2 },
    ];
    for (const side of sides) {
      const at = (t: number) => ({
        x: cx + side.nx * edge + (side.nz !== 0 ? t : 0),
        z: cz + side.nz * edge + (side.nx !== 0 ? t : 0),
      });
      // Behind the spawn, a curb tree would fill the arrival view: move it aside. The office
      // block's east curb lies on the sightline to the vista park, so it keeps only its lamps.
      const behindSpawn = block.kind === "office" && side.nz === 1;
      const onSightline = block.kind === "office" && side.nx === 1;
      for (const t of [-11, 0, 11]) furniture.push({ kind: "lamp", ...at(t), yaw: side.yaw, scale: 1 });
      for (const t of onSightline ? [] : behindSpawn ? [-8.5, 5.5] : [-5.5, 5.5]) {
        furniture.push({ kind: "tree", ...at(t), yaw: range(random, 0, Math.PI * 2), scale: range(random, 0.85, 1.15) });
      }
      if (random() < 0.45) furniture.push({ kind: "bin", ...at(1.3), yaw: side.yaw, scale: 1 });
    }
  }
  // The plaza: benches along the ledges, a tree at each front corner.
  for (const z of [3.5, 6, 8.5]) {
    furniture.push({ kind: "bench", x: -11.2, z, yaw: Math.PI / 2, scale: 1 });
    furniture.push({ kind: "bench", x: 11.2, z, yaw: -Math.PI / 2, scale: 1 });
  }
  furniture.push({ kind: "tree", x: -10.5, z: 11.6, yaw: 0.6, scale: 1.1 }, { kind: "tree", x: 10.5, z: 11.6, yaw: 2.1, scale: 1.05 });
  // The garden (Paris sets out its café there instead).
  if (location.landmarkKit !== "eiffel") {
    for (const [x, z] of [
      [6, -10],
      [10.5, -9],
      [6.5, -4],
      [10.8, -3],
    ]) {
      furniture.push({ kind: "tree", x: x + range(random, -0.4, 0.4), z: z + range(random, -0.4, 0.4), yaw: range(random, 0, 6.3), scale: range(random, 0.9, 1.2) });
    }
    furniture.push({ kind: "bench", x: 8.5, z: -6.5, yaw: -Math.PI / 2, scale: 1 });
  }

  // Parks: trees on a jittered grid, clear of the cross paths (and of the landmark's ground).
  const landmarkPark = { x: cellCentre(VISTA_CELL.i) + 3, z: cellCentre(VISTA_CELL.j) - 3 };
  for (const block of blocks) {
    if (block.kind !== "park" && block.kind !== "vista") continue;
    const area = inset(block.rect, CITY.pavement + 0.8);
    for (let gz = -area.d / 2 + 2; gz <= area.d / 2 - 2; gz += 5.2) {
      for (let gx = -area.w / 2 + 2; gx <= area.w / 2 - 2; gx += 5.2) {
        const x = block.rect.x + gx + range(random, -1, 1);
        const z = block.rect.z + gz + range(random, -1, 1);
        if (Math.abs(x - block.rect.x) < 2.4 || Math.abs(z - block.rect.z) < 2.4) continue;
        if (block.kind === "vista" && Math.hypot(x - landmarkPark.x, z - landmarkPark.z) < 13) continue;
        if (random() < 0.3) continue;
        furniture.push({ kind: "tree", x, z, yaw: range(random, 0, 6.3), scale: range(random, 0.9, 1.35) });
      }
    }
    if (block.kind === "park") {
      for (const [dx, dz, yaw] of [
        [4.5, -1.6, Math.PI],
        [-4.5, 1.6, 0],
        [1.6, 4.5, Math.PI / 2],
        [-1.6, -4.5, -Math.PI / 2],
      ]) {
        furniture.push({ kind: "bench", x: block.rect.x + dx, z: block.rect.z + dz, yaw, scale: 1 });
      }
    }
  }

  // Traffic: a loop each way round the central block and round the ring road. Lanes keep to
  // the right (or the left), so clockwise traffic takes the inner lane where cars drive on the right.
  const lane = (clockwise: boolean) => (clockwise !== driveOnLeft ? -CITY.lane : CITY.lane);
  const inner = CITY.pitch / 2;
  const outer = CITY.pitch * 1.5;
  const loops = [
    roundedSquareLoop("inner-cw", { half: inner + lane(true), radius: 5, clockwise: true }),
    roundedSquareLoop("inner-ccw", { half: inner + lane(false), radius: 5, clockwise: false }),
    roundedSquareLoop("outer-cw", { half: outer + lane(true), radius: 6, clockwise: true }),
    roundedSquareLoop("outer-ccw", { half: outer + lane(false), radius: 6, clockwise: false }),
  ];

  // Spawn on the plaza facing the doors; come back out a few steps in front of them.
  const y = CITY.curb;
  const spawn: CitySpawn = { position: [office.door.x, y, 11], yaw: Math.PI, pitch: 0.1 };
  const exit: CitySpawn = { position: [office.door.x, y, 3.2], yaw: 0 };
  const entrance: Box = { center: [office.door.x, 1, -office.vestibule / 2 - 0.2], half: [office.door.width / 2 - 0.2, 1, 0.5] };

  const walk = walkGraph(blocks, spawn, office);
  const crossings = crossingsOf(blocks);

  // Both anchors turn their local +z towards the spawn, so a kit is built facing the plaza.
  const far = { x: 98, z: -98 };
  const towards = (from: { x: number; z: number }) => Math.atan2(spawn.position[0] - from.x, spawn.position[2] - from.z);
  const landmark = { park: landmarkPark, far, yaw: towards(landmarkPark), farYaw: towards(far) };

  const colliders = cityColliders({ blocks, buildings, office, ledges, furniture });

  return {
    seed,
    kit: location.landmarkKit,
    palette,
    driveOnLeft,
    blocks,
    roads: roads(),
    crossings,
    plaza,
    ledges,
    garden,
    buildings,
    skyline,
    furniture,
    loops,
    walk,
    office,
    spawn,
    exit,
    entrance,
    landmark,
    vista,
    colliders,
  };
}

function walkGraph(blocks: CityBlock[], spawn: CitySpawn, office: OfficeSite): WalkGraph {
  const nodes: WalkNode[] = [];
  const edges: [number, number][] = [];
  const add = (x: number, z: number, kind: WalkNodeKind) => {
    nodes.push({ id: nodes.length, x, z, kind });
    return nodes.length - 1;
  };
  const corner = CITY.block / 2 - CITY.walkInset;
  // Corners per block: NW, NE, SE, SW.
  const corners = new Map<string, number[]>();
  for (const block of blocks) {
    const { x, z } = block.rect;
    const ids = [
      add(x - corner, z - corner, "pavement"),
      add(x + corner, z - corner, "pavement"),
      add(x + corner, z + corner, "pavement"),
      add(x - corner, z + corner, "pavement"),
    ];
    corners.set(`${block.i},${block.j}`, ids);
    for (let k = 0; k < 4; k++) edges.push([ids[k], ids[(k + 1) % 4]]);
  }
  for (const block of blocks) {
    const here = corners.get(`${block.i},${block.j}`)!;
    const east = corners.get(`${block.i + 1},${block.j}`);
    const south = corners.get(`${block.i},${block.j + 1}`);
    if (east) edges.push([here[1], east[0]], [here[2], east[3]]);
    if (south) edges.push([here[3], south[0]], [here[2], south[1]]);
  }
  const centre = corners.get(`${OFFICE_CELL.i},${OFFICE_CELL.j}`)!;
  const start = add(spawn.position[0], spawn.position[2], "spawn");
  const door = add(office.door.x, office.door.z + 2.2, "entrance");
  const plaza = add(7, 6, "plaza");
  edges.push([start, door], [start, centre[3]], [start, centre[2]], [start, plaza], [plaza, centre[2]]);

  const neighbours: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  return { nodes, edges, neighbours };
}

function crossingsOf(blocks: CityBlock[]): Crossing[] {
  const corner = CITY.block / 2 - CITY.walkInset;
  const result: Crossing[] = [];
  for (const block of blocks) {
    const { x, z } = block.rect;
    if (block.i < 2) {
      for (const dz of [-corner, corner]) result.push({ x: x + CITY.pitch / 2, z: z + dz, across: "x" });
    }
    if (block.j < 2) {
      for (const dx of [-corner, corner]) result.push({ x: x + dx, z: z + CITY.pitch / 2, across: "z" });
    }
  }
  return result;
}

const FURNITURE_HALF: Record<FurnitureKind, Vec3> = {
  lamp: [0.12, 2.2, 0.12],
  tree: [0.2, 1.6, 0.2],
  bench: [0.8, 0.25, 0.28],
  bin: [0.22, 0.45, 0.22],
};

/** A small box per lamp, tree, bench and bin, standing on `base`. */
export function furnitureColliders(furniture: Furniture[], base: number): CityCollider[] {
  return furniture.map((item) => {
    const half = FURNITURE_HALF[item.kind];
    // Benches turn with their yaw; quarter turns swap the footprint.
    const turned = Math.abs(Math.sin(item.yaw)) > 0.7;
    return { kind: "furniture", center: [item.x, base + half[1], item.z], half: turned ? [half[2], half[1], half[0]] : half };
  });
}

function cityColliders({
  blocks,
  buildings,
  office,
  ledges,
  furniture,
}: Pick<CityLayout, "blocks" | "buildings" | "office" | "ledges" | "furniture">): CityCollider[] {
  const colliders: CityCollider[] = [{ kind: "ground", center: [0, -0.5, 0], half: [320, 0.5, 320] }];
  const curb = CITY.curb;
  for (const block of blocks) {
    colliders.push({ kind: "block", center: [block.rect.x, curb / 2, block.rect.z], half: [block.rect.w / 2, curb / 2, block.rect.d / 2] });
  }
  for (const building of buildings) {
    const { rect, height } = building;
    colliders.push({ kind: "building", center: [rect.x, curb + height / 2, rect.z], half: [rect.w / 2, height / 2, rect.d / 2] });
  }

  // The office: the tower behind the vestibule, and the two piers either side of the doors.
  const { rect, height, door, vestibule } = office;
  const x0 = rect.x - rect.w / 2;
  const x1 = rect.x + rect.w / 2;
  const z0 = rect.z - rect.d / 2;
  const front = rect.z + rect.d / 2;
  const box = (bx0: number, bx1: number, bz0: number, bz1: number): CityCollider => ({
    kind: "office",
    center: [(bx0 + bx1) / 2, curb + height / 2, (bz0 + bz1) / 2],
    half: [(bx1 - bx0) / 2, height / 2, (bz1 - bz0) / 2],
  });
  colliders.push(
    box(x0, x1, z0, front - vestibule),
    box(x0, door.x - door.width / 2, front - vestibule, front),
    box(door.x + door.width / 2, x1, front - vestibule, front),
  );

  for (const ledge of ledges) {
    colliders.push({ kind: "plaza-edge", center: [ledge.x, curb + 0.225, ledge.z], half: [ledge.w / 2, 0.225, ledge.d / 2] });
  }
  colliders.push(...furnitureColliders(furniture, curb));

  // Boundary walls just outside the ring road.
  const edge = CITY.half + 0.5;
  colliders.push(
    { kind: "boundary", center: [0, 1.5, -edge], half: [edge, 1.5, 0.5] },
    { kind: "boundary", center: [0, 1.5, edge], half: [edge, 1.5, 0.5] },
    { kind: "boundary", center: [-edge, 1.5, 0], half: [0.5, 1.5, edge] },
    { kind: "boundary", center: [edge, 1.5, 0], half: [0.5, 1.5, edge] },
  );
  return colliders;
}

/** The facade windows of a building: a grid per facade, a lit share per window (0 = dark). */
export function windowsOf(building: CityBuilding, seed: number): Window[] {
  const random = mulberry32(hashString(building.id) ^ seed);
  const { rect, floors } = building;
  const result: Window[] = [];
  const curb = CITY.curb;
  for (const face of building.faces) {
    const alongX = face === "north" || face === "south";
    const span = alongX ? rect.w : rect.d;
    const columns = Math.max(1, Math.floor((span - 1.6) / 2.9));
    const gap = span / columns;
    const offset = 0.03;
    const yaw = face === "east" ? Math.PI / 2 : face === "west" ? -Math.PI / 2 : face === "south" ? 0 : Math.PI;
    for (let floor = 1; floor < floors; floor++) {
      const y = curb + CITY.groundFloor + (floor - 1) * CITY.floorHeight + CITY.floorHeight * 0.5;
      for (let c = 0; c < columns; c++) {
        const t = -span / 2 + gap * (c + 0.5);
        const lit = random() < 0.42 ? range(random, 0.55, 1) : 0;
        if (alongX) {
          result.push({ x: rect.x + t, y, z: rect.z + (face === "south" ? rect.d / 2 + offset : -rect.d / 2 - offset), yaw, lit });
        } else {
          result.push({ x: rect.x + (face === "east" ? rect.w / 2 + offset : -rect.w / 2 - offset), y, z: rect.z + t, yaw, lit });
        }
      }
    }
  }
  return result;
}

/** Breadth-first search on the walk graph: true when `to` can be reached from `from`. */
export function reachable(graph: WalkGraph, from: number, to: number): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === to) return true;
    for (const next of graph.neighbours[node]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** The walking surface's height at a point: the curb on a block, the road surface between. */
export function groundHeight(x: number, z: number): number {
  const onBlock = (t: number) => {
    const centre = Math.max(-1, Math.min(1, Math.round(t / CITY.pitch))) * CITY.pitch;
    return Math.abs(t - centre) <= CITY.block / 2;
  };
  return onBlock(x) && onBlock(z) ? CITY.curb : 0;
}

/** True when the point stands inside the box (the entrance trigger). */
export function insideBox(point: { x: number; y: number; z: number }, { center, half }: Box): boolean {
  return (
    Math.abs(point.x - center[0]) <= half[0] &&
    Math.abs(point.y - center[1]) <= half[1] &&
    Math.abs(point.z - center[2]) <= half[2]
  );
}
