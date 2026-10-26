import type { Box, Door, Room, Spot, Vec3 } from "../floorplan";
import { rectEdges } from "../floorplan";

/**
 * The auditorium in the presentation room (phase O7 › Room), as data. Pure, in world space:
 *
 *   west wall: the screen            east wall: the door from the lobby
 *   [stage + lectern][front][row 0][row 1][row 2][row 3]|rail|[ cross-aisle ]  door
 *                                                                ↑ south aisle (floor level) runs
 *                                                                  along the rows to the front
 *
 * Rows rise 0.2 m each towards the back (one step for the character controller), six seats a
 * row, all facing the screen; the back row has a rail above the cross-aisle. The south aisle is
 * level with the door, so the front, the stage step and the presenter are reachable on foot.
 */
export type Seat = { id: string; position: Vec3; yaw: number; row: number };

export type Auditorium = {
  screen: { center: Vec3; width: number; height: number; yaw: number };
  stage: Box;
  stageStep: Box;
  rows: { index: number; x0: number; x1: number; height: number }[];
  /** Rows from `z0` to `z1` (north to the south aisle). */
  rowSpan: { z0: number; z1: number };
  seats: Seat[];
  lectern: Spot;
  presenter: Spot;
  rail: Box;
  /** Every solid piece: risers, the stage, the seat rows, the rail, the lectern. */
  colliders: Box[];
};

export const ROWS = 4;
export const SEATS_PER_ROW = 6;
export const RISE = 0.2;
const ROW_DEPTH = 1.5;
const STAGE_DEPTH = 2.7;
const STAGE_HEIGHT = 0.34;
const SEAT_SPACING = 1.2;
/** Seat centres sit this far in front of their row's back edge. */
const SEAT_SET_BACK = 0.5;
const WALL_GAP = 0.1;
/** Half a chair's width, and the chair block's half-length along a row. */
const CHAIR_HALF = 0.3;
const BLOCK_HALF = ((SEATS_PER_ROW - 1) * SEAT_SPACING) / 2 + CHAIR_HALF;
/** The walkway between the chair block and the rows' open south edge. */
export const LANE = 0.95;
/** 16:9, under the 3.2 m ceiling. */
export const SCREEN = { width: 4.4, height: 2.475, centerY: 1.86 };
/** The screen's frame: a box this far off the west wall, and the screen just in front of it. */
export const SCREEN_FRAME = { offset: 0.13, depth: 0.06 };
const SCREEN_OFFSET = SCREEN_FRAME.offset + SCREEN_FRAME.depth / 2 + 0.02;

/** Seats face the screen, on the west wall: heading -x. */
const FACING_WEST = -Math.PI / 2;

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Box => ({
  center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  half: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2],
});

export function auditoriumLayout(room: Room, door: Pick<Door, "z" | "width">): Auditorium {
  const { x0, z0, z1 } = rectEdges(room.rect);
  // The rows end short of the door's centre line, leaving a level aisle from the door to the front.
  const rowZ1 = Math.min(z1 - 3.5, door.z - door.width / 4);
  const rowZ0 = z0 + WALL_GAP;
  const firstRow = x0 + STAGE_DEPTH + 1.7;

  const rows = Array.from({ length: ROWS }, (_, index) => ({
    index,
    x0: firstRow + index * ROW_DEPTH,
    x1: firstRow + (index + 1) * ROW_DEPTH,
    height: index * RISE,
  }));

  // The block of seats (the screen is centred on it), with a lane between it and the aisle so
  // every row can be walked to: the rows step up 0.2 m each along it.
  const middle = rowZ1 - LANE - CHAIR_HALF - ((SEATS_PER_ROW - 1) * SEAT_SPACING) / 2;
  const seats: Seat[] = rows.flatMap((row) =>
    Array.from({ length: SEATS_PER_ROW }, (_, column) => ({
      id: `seat:${row.index + 1}-${column + 1}`,
      row: row.index,
      position: [row.x1 - SEAT_SET_BACK, row.height, middle + (column - (SEATS_PER_ROW - 1) / 2) * SEAT_SPACING] as Vec3,
      yaw: FACING_WEST,
    })),
  );

  // Proud of its frame (a 6 cm box centred 0.13 m off the wall), or the frame would hide it.
  const screen = { center: [x0 + SCREEN_OFFSET, SCREEN.centerY, middle] as Vec3, width: SCREEN.width, height: SCREEN.height, yaw: Math.PI / 2 };
  const stage = box(x0, x0 + STAGE_DEPTH, 0, STAGE_HEIGHT, z0, z1);
  // One step up at the south end of the stage front, by the aisle.
  const stageStep = box(x0 + STAGE_DEPTH, x0 + STAGE_DEPTH + 0.45, 0, STAGE_HEIGHT / 2, rowZ1 + 0.4, rowZ1 + 2.6);
  const lectern: Spot = { position: [x0 + STAGE_DEPTH - 0.75, STAGE_HEIGHT, middle + SCREEN.width / 2 + 1.1], yaw: Math.PI / 2 - 0.35 };
  const presenter: Spot = { position: [x0 + STAGE_DEPTH - 1.45, STAGE_HEIGHT, middle + SCREEN.width / 2 + 1.75], yaw: Math.PI / 2 - 0.5 };
  const back = rows[ROWS - 1];
  const rail = box(back.x1 - 0.06, back.x1, back.height, back.height + 1, rowZ0, rowZ1);

  const colliders: Box[] = [stage, stageStep, rail, box(lectern.position[0] - 0.3, lectern.position[0] + 0.3, STAGE_HEIGHT, STAGE_HEIGHT + 1.1, lectern.position[2] - 0.3, lectern.position[2] + 0.3)];
  for (const row of rows) {
    if (row.height > 0) colliders.push(box(row.x0, row.x1, 0, row.height, rowZ0, rowZ1));
    // The chairs of a row, as one block (seat and back), set back from its front edge.
    const seatX = row.x1 - SEAT_SET_BACK;
    colliders.push(box(seatX - 0.3, seatX + 0.3, row.height, row.height + 0.9, middle - BLOCK_HALF, middle + BLOCK_HALF));
  }

  return { screen, stage, stageStep, rows, rowSpan: { z0: rowZ0, z1: rowZ1 }, seats, lectern, presenter, rail, colliders };
}

/** The point a seated camera looks at: midway between the screen's centre and the presenter's head. */
export function presenterShot(layout: Pick<Auditorium, "screen" | "presenter">): Vec3 {
  const { center } = layout.screen;
  const [px, py, pz] = layout.presenter.position;
  return [(center[0] + px) / 2, (center[1] + py + 1.6) / 2, (center[2] + pz) / 2];
}

/** How far a seated camera may sit from the shot's point: far enough back to fit screen and presenter. */
export const SEAT_REACH = 6.4;

/**
 * Where the camera sits for a seat (phase O7 › Room: "the camera frames the screen"): on the line
 * from the seated head to the shot's point, no farther than `reach` from it, so every seat frames
 * the whole screen from its own angle.
 */
export function seatCamera(seat: Pick<Seat, "position">, screen: Vec3, reach = 4.7): Vec3 {
  const head: Vec3 = [seat.position[0], seat.position[1] + 1.2, seat.position[2]];
  const dx = head[0] - screen[0];
  const dy = head[1] - screen[1];
  const dz = head[2] - screen[2];
  const distance = Math.hypot(dx, dy, dz);
  if (distance <= reach) return head;
  const k = reach / distance;
  return [screen[0] + dx * k, screen[1] + dy * k, screen[2] + dz * k];
}
