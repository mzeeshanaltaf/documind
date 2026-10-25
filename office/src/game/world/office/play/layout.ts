import type { GameId } from "@/game/games/types";
import { type Box, type Door, type Room, type Spot, type Vec3, rectEdges } from "../floorplan";

/**
 * The play area as data (phase O8 › Room), in world space, derived from the floor plan's room
 * (east of the lobby, its door on the west wall). Pure, so the scene and the tests share it:
 *
 *   north wall:  [ beanbags ]   [ leaderboard wall ]            [ arcade ×2 ]  east wall
 *   middle:                     [ table tennis ]                [ jukebox ]
 *   west door ──►                                               [ coffee ]
 *   south wall:                 [ conveyor + three bins (Sort & Toss) ]
 *
 * Stations are solid; each has an "interaction spot" in front of it where its prompt appears.
 */
export type StationKind = GameId | "leaderboard" | "jukebox" | "coffee";
export type Station = {
  id: StationKind;
  /** The prompt's verb phrase. */
  label: string;
  /** Where the prompt is measured from (on the floor, in front of the piece). */
  spot: Vec3;
  radius: number;
  /** Where the camera frames while playing (the piece itself, about eye height). */
  focus: Vec3;
};

export type Beanbag = { id: string; position: Vec3; yaw: number; radius: number; color: number };

export type PlayLayout = {
  stations: Station[];
  beanbags: Beanbag[];
  /** Every solid piece. */
  colliders: Box[];
  /** The leaderboard wall's panel (3.8 : 1), facing south. */
  wall: { center: Vec3; width: number; height: number; yaw: number };
  arcade: { position: Vec3; yaw: number }[];
  table: { center: Vec3; length: number; width: number; height: number };
  conveyor: { x0: number; x1: number; z: number };
  bins: { id: "paper" | "recycling" | "general"; position: Vec3 }[];
  jukebox: { position: Vec3; yaw: number };
  coffee: { counter: Box; machine: Vec3; yaw: number };
  /** The notice signs over each station. */
  signs: { id: StationKind; title: string; line: string; position: Vec3; yaw: number }[];
  rug: { center: Vec3; radius: number };
};

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => ({
  center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});

export const TABLE = { length: 2.74, width: 1.525, height: 0.76 };
const WEST = -Math.PI / 2;

export function playLayout(room: Room, door: Pick<Door, "z" | "width">): PlayLayout {
  const { x0, x1, z0, z1 } = rectEdges(room.rect);
  const mid = (x0 + x1) / 2;
  const colliders: Box[] = [];

  // Arcade cabinets on the east wall, facing west; the first is Policy Trivia's.
  const cabinetX = x1 - 0.7;
  const arcade = [z0 + 3.4, z0 + 1.8].map((z) => ({ position: [cabinetX, 0, z] as Vec3, yaw: WEST }));
  for (const { position } of arcade) colliders.push(box(position[0] - 0.45, position[0] + 0.45, 0, 1.9, position[2] - 0.5, position[2] + 0.5));

  // The jukebox, then the coffee counter, further down the east wall.
  const jukebox = { position: [x1 - 0.6, 0, z0 + 6.4] as Vec3, yaw: WEST };
  colliders.push(box(jukebox.position[0] - 0.4, jukebox.position[0] + 0.4, 0, 1.55, jukebox.position[2] - 0.5, jukebox.position[2] + 0.5));
  const counterZ = z0 + 10;
  const counter = box(x1 - 1.0, x1 - 0.12, 0, 0.92, counterZ - 1.1, counterZ + 1.1);
  colliders.push(counter);
  const coffee = { counter, machine: [x1 - 0.55, 0.92, counterZ] as Vec3, yaw: WEST };

  // Table tennis in the middle, its long side along x.
  const table = { center: [mid - 1.2, 0, (z0 + z1) / 2 - 0.4] as Vec3, ...TABLE };
  colliders.push(
    box(table.center[0] - TABLE.length / 2 - 0.05, table.center[0] + TABLE.length / 2 + 0.05, 0, TABLE.height + 0.14, table.center[2] - TABLE.width / 2 - 0.05, table.center[2] + TABLE.width / 2 + 0.05),
  );

  // The sorting station along the south wall: a conveyor, then three bins.
  const stationZ = z1 - 0.55;
  const conveyor = { x0: mid - 4.4, x1: mid + 1.2, z: stationZ };
  const binXs = [mid + 2.3, mid + 3.2, mid + 4.1];
  const bins = (["paper", "recycling", "general"] as const).map((id, index) => ({ id, position: [binXs[index], 0, stationZ] as Vec3 }));
  colliders.push(box(conveyor.x0 - 0.1, binXs[2] + 0.45, 0, 0.95, stationZ - 0.5, stationZ + 0.45));

  // Beanbags in the north-west corner, round a small rug, facing the room's middle.
  const rug = { center: [x0 + 2.6, 0.01, z0 + 2.6] as Vec3, radius: 1.9 };
  const facing = (position: Vec3): number => Math.atan2(mid - position[0], (z0 + z1) / 2 - position[2]);
  const beanbagAt = (id: string, dx: number, dz: number, color: number): Beanbag => {
    const position: Vec3 = [rug.center[0] + dx, 0, rug.center[2] + dz];
    return { id, position, yaw: facing(position), radius: 0.5, color };
  };
  const beanbags = [beanbagAt("beanbag:1", -0.55, -0.95, 0), beanbagAt("beanbag:2", 1.05, -0.4, 1), beanbagAt("beanbag:3", -0.35, 1.0, 2)];
  for (const bag of beanbags) colliders.push(box(bag.position[0] - 0.42, bag.position[0] + 0.42, 0, 0.6, bag.position[2] - 0.42, bag.position[2] + 0.42));

  // The leaderboard wall: the north wall, over the middle.
  const wall = { center: [mid + 0.4, 1.95, z0 + 0.14] as Vec3, width: 8.4, height: 2.2, yaw: 0 };

  const stations: Station[] = [
    {
      id: "trivia",
      label: "Play Policy Trivia",
      spot: [cabinetX - 1.0, 0, arcade[0].position[2]],
      radius: 1.5,
      focus: [cabinetX, 1.35, arcade[0].position[2]],
    },
    {
      id: "sort_toss",
      label: "Play Sort & Toss",
      spot: [mid - 1.6, 0, stationZ - 1.1],
      radius: 2.6,
      focus: [mid - 1.6, 1.0, stationZ],
    },
    {
      id: "table_tennis",
      label: "Play Desk Table Tennis",
      spot: [table.center[0], 0, table.center[2]],
      radius: 2.3,
      focus: [table.center[0], 0.9, table.center[2]],
    },
    {
      id: "leaderboard",
      label: "Read the leaderboards",
      spot: [wall.center[0], 0, z0 + 1.7],
      radius: 3.6,
      focus: [wall.center[0], 1.9, wall.center[2]],
    },
    {
      id: "jukebox",
      label: "Pick the music",
      spot: [jukebox.position[0] - 1.0, 0, jukebox.position[2]],
      radius: 1.4,
      focus: [jukebox.position[0], 1.2, jukebox.position[2]],
    },
    {
      id: "coffee",
      label: "Brew a coffee",
      spot: [coffee.machine[0] - 1.1, 0, counterZ],
      radius: 1.4,
      focus: [coffee.machine[0], 1.2, counterZ],
    },
  ];

  const signs: PlayLayout["signs"] = [
    { id: "trivia", title: "Policy Trivia", line: "Arcade", position: [x1 - 0.14, 2.35, arcade[0].position[2]], yaw: WEST },
    { id: "sort_toss", title: "Sort & Toss", line: "Recycling rules", position: [conveyor.x0 + 2.8, 2.15, z1 - 0.13], yaw: Math.PI },
  ];

  void door;
  return { stations, beanbags, colliders, wall, arcade, table, conveyor, bins, jukebox, coffee, signs, rug };
}

/** The beanbags as seats (`Seat.relaxed`: the camera settles). Standing up lands in front. */
export function beanbagSeats(layout: PlayLayout) {
  return layout.beanbags.map((bag) => ({ id: bag.id, position: bag.position, yaw: bag.yaw, relaxed: true as const }));
}

/** Where an NPC-free spot like the doorway lane runs: the strip from the door into the room. */
export function doorLane(room: Room, door: Pick<Door, "z" | "width">): Box {
  const { x0 } = rectEdges(room.rect);
  return box(x0, x0 + 2.6, 0, 2.5, door.z - door.width / 2 - 0.2, door.z + door.width / 2 + 0.2);
}

export const spotOf = (position: Vec3, yaw: number): Spot => ({ position, yaw });
