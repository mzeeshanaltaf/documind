import type { Box, CityCollider, CitySpawn, OfficeSite, Rect, WalkGraph, WalkNode } from "./generator";

/**
 * The Global Hub (phase O4 › 6): a floating island campus with the hub building to the north,
 * its doors facing the plaza, and one portal kiosk per office along the plaza's sides. Pure.
 */
export type Kiosk = { index: number; x: number; z: number; yaw: number };

export type HubLayout = {
  /** The island's walkable radius; a railing runs round it. */
  radius: number;
  office: OfficeSite;
  spawn: CitySpawn;
  exit: CitySpawn;
  entrance: Box;
  kiosks: Kiosk[];
  colliders: CityCollider[];
  walk: WalkGraph;
};

const RADIUS = 30;
const RAIL_SEGMENTS = 36;

export function hubLayout(kioskCount: number): HubLayout {
  const rect: Rect = { x: 0, z: -14, w: 16, d: 12 };
  const office: OfficeSite = {
    rect,
    podium: 5.2,
    height: 14,
    door: { x: 0, z: rect.z + rect.d / 2, yaw: 0, width: 2.6 },
    vestibule: 1.6,
  };
  const front = office.door.z;
  const spawn: CitySpawn = { position: [0, 0, front + 12], yaw: Math.PI, pitch: 0.1 };
  const exit: CitySpawn = { position: [0, 0, front + 3.2], yaw: 0 };
  const entrance: Box = { center: [0, 1, front - office.vestibule / 2 - 0.2], half: [office.door.width / 2 - 0.2, 1, 0.5] };

  // Kiosks alternate west and east of the plaza, three rows deep (more rows if there are more).
  const kiosks: Kiosk[] = Array.from({ length: kioskCount }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    return { index, x: side * 11, z: front + 6 + row * 7, yaw: side === -1 ? Math.PI / 2 : -Math.PI / 2 };
  });

  const height = office.height;
  const x0 = rect.x - rect.w / 2;
  const x1 = rect.x + rect.w / 2;
  const box = (bx0: number, bx1: number, bz0: number, bz1: number): CityCollider => ({
    kind: "office",
    center: [(bx0 + bx1) / 2, height / 2, (bz0 + bz1) / 2],
    half: [(bx1 - bx0) / 2, height / 2, (bz1 - bz0) / 2],
  });
  const colliders: CityCollider[] = [
    { kind: "ground", center: [0, -0.5, 0], half: [RADIUS + 2, 0.5, RADIUS + 2] },
    box(x0, x1, rect.z - rect.d / 2, front - office.vestibule),
    box(x0, office.door.x - office.door.width / 2, front - office.vestibule, front),
    box(office.door.x + office.door.width / 2, x1, front - office.vestibule, front),
    ...kiosks.map<CityCollider>((kiosk) => ({ kind: "furniture", center: [kiosk.x, 1.4, kiosk.z], half: [0.5, 1.4, 0.9] })),
  ];
  const segment = ((2 * Math.PI * RADIUS) / RAIL_SEGMENTS) * 0.55;
  for (let k = 0; k < RAIL_SEGMENTS; k++) {
    const angle = (k / RAIL_SEGMENTS) * Math.PI * 2;
    colliders.push({
      kind: "boundary",
      center: [Math.sin(angle) * RADIUS, 0.6, Math.cos(angle) * RADIUS],
      half: [segment, 0.6, 0.25],
      // A turn of `angle` lays the box's long (x) side along the ring's tangent there.
      yaw: angle,
    });
  }

  return { radius: RADIUS, office, spawn, exit, entrance, kiosks, colliders, walk: hubWalk(spawn) };
}

/** A ring path round the campus with spokes to the plaza. */
function hubWalk(spawn: CitySpawn): WalkGraph {
  const nodes: WalkNode[] = [];
  const edges: [number, number][] = [];
  const ring = 12;
  for (let k = 0; k < ring; k++) {
    const angle = (k / ring) * Math.PI * 2;
    nodes.push({ id: k, x: Math.sin(angle) * 24, z: Math.cos(angle) * 24, kind: "pavement" });
    edges.push([k, (k + 1) % ring]);
  }
  const plaza = (x: number, z: number, kind: WalkNode["kind"]) => {
    nodes.push({ id: nodes.length, x, z, kind });
    return nodes.length - 1;
  };
  const start = plaza(spawn.position[0], spawn.position[2], "spawn");
  const west = plaza(-5, spawn.position[2] - 3, "plaza");
  const east = plaza(5, spawn.position[2] - 3, "plaza");
  // Ring node 0 is due south of the centre; 3 is east, 9 is west.
  edges.push([start, 0], [start, west], [start, east], [west, 9], [east, 3]);
  const neighbours: number[][] = nodes.map(() => []);
  for (const [a, b] of edges) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  return { nodes, edges, neighbours };
}
