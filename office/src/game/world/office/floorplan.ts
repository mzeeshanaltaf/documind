import { orderDepartments } from "@/lib/departments";

/**
 * The office interior as data (phase O5 › Floor plan). Pure: rooms, walls (rapier cuboids),
 * doors, spawns and NPC spots, all derived from the org's departments, so the scene, the minimap
 * and the tests read the same plan.
 *
 * Axes as in the city: x east, z south. The street doors are in the lobby's south wall; walking
 * in faces north (-z).
 *
 *              [ lift → rooftop ]
 *   [ Compliance ][ corridor ][ Facilities ]   …bays continue north
 *   [ IT         ][ corridor ][ Finance    ]
 *   [ HR         ][ corridor ][ Procurement]   rooms alternate west / east
 *   [ presentation ][     lobby      ][ play area ]
 *                     street doors
 */

export type Vec3 = [number, number, number];
/** Centred, like the city's: `w` along x, `d` along z. */
export type Rect = { x: number; z: number; w: number; d: number };
export type Box = { center: Vec3; half: Vec3 };

export type RoomKind = "lobby" | "presentation" | "play" | "corridor" | "department";
export type Room = {
  /** `lobby`, `presentation`, `play`, `corridor`, `dept:HR`… */
  id: string;
  kind: RoomKind;
  name: string;
  department?: string;
  rect: Rect;
  /** Department rooms: which side of the corridor. */
  side?: "west" | "east";
};

/** `h` walls run along x (a constant z); `v` walls run along z (a constant x). */
export type Orient = "h" | "v";
export type WallKind = "wall" | "glass" | "header";
export type Wall = Box & { kind: WallKind; orient: Orient };

export type DoorKind = "street" | "open" | "security" | "department" | "lift";
export type Door = {
  id: string;
  kind: DoorKind;
  /** Room ids; `street` and `rooftop` lead out of the plan. */
  from: string;
  to: string;
  orient: Orient;
  x: number;
  z: number;
  width: number;
  /** `card:HR`, `card:*` (any card) or `unlock:rooftop`; open doors have none. */
  requires?: string;
  /** Which side the door's card reader and sign face (the side you approach a locked door from). */
  facing: Vec3;
};

/** `yaw` as everywhere: the heading, 0 faces +z. */
export type Spot = { position: Vec3; yaw: number };

export type Floorplan = {
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  spawns: { lobby_entrance: Spot; lift: Spot };
  /** `reception`, `expert:HR`… */
  npcSpots: Record<string, Spot>;
  /** Fixed lobby furniture: the reception desk, the badge booth, the waiting area. */
  props: { desk: Spot; booth: Spot; waiting: Spot; directory: Spot; clock: Spot; mark: Spot };
  /** The street doors' trigger: walking into it leaves for the city. */
  exit: Box;
  bounds: Rect;
};

export type FloorplanOptions = {
  wallHeight?: number;
  wallThickness?: number;
  /** Depth of one corridor bay (one room on each side). */
  bay?: number;
  roomWidth?: number;
  corridorWidth?: number;
};

const DEFAULTS: Required<FloorplanOptions> = { wallHeight: 3.2, wallThickness: 0.2, bay: 8, roomWidth: 8, corridorWidth: 3.2 };

/** The lobby doesn't depend on the departments: the city's entrance spawn can be static. */
export const LOBBY: Rect = { x: 0, z: 0, w: 16, d: 14 };
const LOBBY_NORTH = LOBBY.z - LOBBY.d / 2;
const LOBBY_SOUTH = LOBBY.z + LOBBY.d / 2;
const SIDE_ROOM_WIDTH = 14;
const DOOR_HEIGHT = 2.5;
/** The landing in front of the rooftop lift, at the corridor's north end. */
const LANDING = 4;

const round = (v: number) => Math.round(v * 1000) / 1000;

export function rectEdges(rect: Rect) {
  return { x0: rect.x - rect.w / 2, x1: rect.x + rect.w / 2, z0: rect.z - rect.d / 2, z1: rect.z + rect.d / 2 };
}

function rectFrom(x0: number, x1: number, z0: number, z1: number): Rect {
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

export function insideRect(rect: Rect, x: number, z: number, margin = 0): boolean {
  const { x0, x1, z0, z1 } = rectEdges(rect);
  return x >= x0 + margin && x <= x1 - margin && z >= z0 + margin && z <= z1 - margin;
}

/** True when the interiors overlap (shared walls don't count). */
export function roomsOverlap(a: Rect, b: Rect): boolean {
  const A = rectEdges(a);
  const B = rectEdges(b);
  const eps = 1e-6;
  return A.x0 < B.x1 - eps && B.x0 < A.x1 - eps && A.z0 < B.z1 - eps && B.z0 < A.z1 - eps;
}

export function buildFloorplan(departments: string[], options: FloorplanOptions = {}): Floorplan {
  const o = { ...DEFAULTS, ...options };
  const ordered = orderDepartments(departments);
  const bays = Math.ceil(ordered.length / 2);
  const half = o.corridorWidth / 2;
  const corridorNorth = LOBBY_NORTH - bays * o.bay - LANDING;
  const lobbyEdges = rectEdges(LOBBY);

  const rooms: Room[] = [
    { id: "lobby", kind: "lobby", name: "Lobby", rect: LOBBY },
    {
      id: "presentation",
      kind: "presentation",
      name: "Presentation room",
      rect: rectFrom(lobbyEdges.x0 - SIDE_ROOM_WIDTH, lobbyEdges.x0, LOBBY_NORTH, LOBBY_SOUTH),
    },
    { id: "play", kind: "play", name: "Play area", rect: rectFrom(lobbyEdges.x1, lobbyEdges.x1 + SIDE_ROOM_WIDTH, LOBBY_NORTH, LOBBY_SOUTH) },
    { id: "corridor", kind: "corridor", name: "Corridor", rect: rectFrom(-half, half, corridorNorth, LOBBY_NORTH) },
  ];

  const sideDoorZ = LOBBY.z + 3;
  const doors: Door[] = [
    { id: "street", kind: "street", from: "lobby", to: "street", orient: "h", x: 0, z: LOBBY_SOUTH, width: 2.6, facing: [0, 0, -1] },
    { id: "presentation", kind: "open", from: "lobby", to: "presentation", orient: "v", x: lobbyEdges.x0, z: sideDoorZ, width: 2.4, facing: [1, 0, 0] },
    { id: "play", kind: "open", from: "lobby", to: "play", orient: "v", x: lobbyEdges.x1, z: sideDoorZ, width: 2.4, facing: [-1, 0, 0] },
    {
      id: "security",
      kind: "security",
      from: "lobby",
      to: "corridor",
      orient: "h",
      x: 0,
      z: LOBBY_NORTH,
      width: 2,
      requires: "card:*",
      facing: [0, 0, 1],
    },
    {
      id: "lift",
      kind: "lift",
      from: "corridor",
      to: "rooftop",
      orient: "h",
      x: 0,
      z: corridorNorth,
      width: 1.8,
      requires: "unlock:rooftop",
      facing: [0, 0, 1],
    },
  ];

  const npcSpots: Record<string, Spot> = {};
  ordered.forEach((department, index) => {
    const bay = Math.floor(index / 2);
    const side = index % 2 === 0 ? "west" : "east";
    const sign = side === "west" ? -1 : 1;
    const z1 = LOBBY_NORTH - bay * o.bay;
    const z0 = z1 - o.bay;
    const near = sign * half;
    const far = sign * (half + o.roomWidth);
    const rect = rectFrom(Math.min(near, far), Math.max(near, far), z0, z1);
    const id = `dept:${department}`;
    rooms.push({ id, kind: "department", name: department, department, rect, side });
    doors.push({
      id,
      kind: "department",
      from: "corridor",
      to: id,
      orient: "v",
      x: near,
      z: rect.z,
      width: 1.6,
      requires: `card:${department}`,
      facing: [-sign, 0, 0],
    });
    // The expert (O6) stands towards the far end of the room, in front of their desk, facing the door.
    const frame = roomFrame({ id, kind: "department", name: department, rect, side });
    npcSpots[`expert:${department}`] = { position: toWorld(frame, expertLocal(frame)), yaw: -Math.PI / 2 + frame.yaw };
  });

  const desk: Spot = { position: [-4.2, 0, LOBBY.z - 2.4], yaw: 0 };
  npcSpots.reception = { position: [desk.position[0], 0, desk.position[2] - 1.05], yaw: 0 };

  const walls = buildWalls(rooms, doors, o);
  const all = rooms.map((room) => rectEdges(room.rect));
  const bounds = rectFrom(
    Math.min(...all.map((e) => e.x0)),
    Math.max(...all.map((e) => e.x1)),
    Math.min(...all.map((e) => e.z0)),
    Math.max(...all.map((e) => e.z1)),
  );

  return {
    rooms,
    walls,
    doors,
    spawns: {
      // Far enough in that the camera behind clears the street wall and looks in over it.
      lobby_entrance: { position: [0, 0, LOBBY_SOUTH - 3.6], yaw: Math.PI },
      lift: { position: [0, 0, corridorNorth + 1.6], yaw: 0 },
    },
    npcSpots,
    props: {
      desk,
      booth: { position: [lobbyEdges.x0 + 0.9, 0, LOBBY.z - 0.6], yaw: Math.PI / 2 },
      waiting: { position: [4.6, 0, LOBBY.z + 2.2], yaw: -Math.PI / 2 },
      directory: { position: [4.2, 0, LOBBY_NORTH + o.wallThickness / 2], yaw: 0 },
      clock: { position: [2.2, 0, LOBBY_NORTH + o.wallThickness / 2], yaw: 0 },
      mark: { position: [desk.position[0], 0, LOBBY_NORTH + o.wallThickness / 2], yaw: 0 },
    },
    exit: { center: [0, 1, LOBBY_SOUTH + 0.5], half: [1.3, 1, 0.4] },
    bounds,
  };
}

type Segment = { orient: Orient; c: number; from: number; to: number; glass: boolean };

/**
 * Every room edge becomes a wall on its grid line; shared edges merge, door openings are cut out
 * (with a header above each), and a department room's corridor side is a glass partition.
 */
function buildWalls(rooms: Room[], doors: Door[], o: Required<FloorplanOptions>): Wall[] {
  const lines = new Map<string, { orient: Orient; c: number; segments: Segment[]; openings: [number, number][] }>();
  const line = (orient: Orient, c: number) => {
    const key = `${orient}:${round(c)}`;
    let entry = lines.get(key);
    if (!entry) lines.set(key, (entry = { orient, c: round(c), segments: [], openings: [] }));
    return entry;
  };

  for (const room of rooms) {
    const { x0, x1, z0, z1 } = rectEdges(room.rect);
    const corridorSide = room.kind === "department" ? (room.side === "west" ? x1 : x0) : null;
    line("h", z0).segments.push({ orient: "h", c: z0, from: x0, to: x1, glass: false });
    line("h", z1).segments.push({ orient: "h", c: z1, from: x0, to: x1, glass: false });
    line("v", x0).segments.push({ orient: "v", c: x0, from: z0, to: z1, glass: corridorSide === x0 });
    line("v", x1).segments.push({ orient: "v", c: x1, from: z0, to: z1, glass: corridorSide === x1 });
  }

  const walls: Wall[] = [];
  const t = o.wallThickness;
  const h = o.wallHeight;
  for (const door of doors) {
    const along = door.orient === "h" ? door.x : door.z;
    const c = door.orient === "h" ? door.z : door.x;
    line(door.orient, c).openings.push([along - door.width / 2, along + door.width / 2]);
    const headerHeight = h - DOOR_HEIGHT;
    walls.push(wallBox(door.orient, c, along - door.width / 2, along + door.width / 2, DOOR_HEIGHT + headerHeight / 2, headerHeight / 2, t, "header"));
  }

  for (const { orient, c, segments, openings } of lines.values()) {
    const points = [...new Set([...segments.flatMap((s) => [s.from, s.to]), ...openings.flat()].map(round))].sort((a, b) => a - b);
    // Elementary intervals, then runs of the same kind.
    let run: { from: number; to: number; kind: WallKind; startsAtDoor: boolean } | null = null;
    const flush = (endsAtDoor: boolean) => {
      if (!run) return;
      const start = run.from - (run.startsAtDoor ? 0 : t / 2);
      const end = run.to + (endsAtDoor ? 0 : t / 2);
      walls.push(wallBox(orient, c, start, end, h / 2, h / 2, t, run.kind));
      run = null;
    };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const mid = (a + b) / 2;
      const covering = segments.filter((s) => s.from <= mid && mid <= s.to);
      const inDoor = openings.some(([d0, d1]) => d0 <= mid && mid <= d1);
      if (covering.length === 0 || inDoor) {
        flush(inDoor);
        continue;
      }
      const kind: WallKind = covering.some((s) => s.glass) ? "glass" : "wall";
      if (run && run.kind === kind && run.to === a) {
        run.to = b;
      } else {
        const atDoor = openings.some(([, d1]) => round(d1) === a);
        flush(false);
        run = { from: a, to: b, kind, startsAtDoor: atDoor };
      }
    }
    flush(false);
  }
  return walls;
}

function wallBox(orient: Orient, c: number, from: number, to: number, y: number, halfY: number, t: number, kind: WallKind): Wall {
  const mid = (from + to) / 2;
  const length = (to - from) / 2;
  return orient === "h"
    ? { center: [mid, y, c], half: [length, halfY, t / 2], kind, orient }
    : { center: [c, y, mid], half: [t / 2, halfY, length], kind, orient };
}

/**
 * A department room's own frame (O6): the origin at its centre, local +x from its door (on the
 * corridor) towards the far wall, so the decor is authored once and turned half round for the
 * west side. `yaw` is the rotation about +y from local to world.
 */
export type RoomFrame = { x: number; z: number; yaw: number; width: number; depth: number };

/** Where the expert stands, in room-local coordinates (in front of their desk, off-centre). */
export const expertLocal = (frame: Pick<RoomFrame, "width">): Vec3 => [frame.width / 2 - 1.6, 0, -1.2];

export function roomFrame(room: Room): RoomFrame {
  return { x: room.rect.x, z: room.rect.z, yaw: room.side === "west" ? Math.PI : 0, width: room.rect.w, depth: room.rect.d };
}

export function toWorld(frame: RoomFrame, [x, y, z]: Vec3): Vec3 {
  const cos = Math.cos(frame.yaw);
  const sin = Math.sin(frame.yaw);
  return [round(frame.x + cos * x + sin * z), y, round(frame.z - sin * x + cos * z)];
}

/** The room containing a point (the first match; doorways sit on shared edges). */
export function roomAt(plan: Floorplan, x: number, z: number): Room | null {
  return plan.rooms.find((room) => insideRect(room.rect, x, z)) ?? null;
}

/** Room ids reachable from `start` through doors (locked or not), by flood fill. */
export function reachableRooms(plan: Floorplan, start = "lobby"): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const room = queue.shift()!;
    for (const door of plan.doors) {
      const next = door.from === room ? door.to : door.to === room ? door.from : null;
      if (next && !seen.has(next) && plan.rooms.some((r) => r.id === next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
