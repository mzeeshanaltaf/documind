import { box, cylinder, type Part } from "../../city/merge";
import { type Room, rectEdges } from "../floorplan";
import { OFFICE } from "../palette";
import { type Auditorium, LANE, SCREEN_FRAME } from "./layout";

/**
 * The auditorium's static pieces as merged parts (phase O7 › Room): the stage and its step, the
 * carpeted risers, 24 chairs, the back rail, the lectern, the screen's frame and speakers, felt
 * wall panels, and the soft lights (wall washers, step lights) that stay lit when the room dims.
 */
const AUDITORIUM = {
  stage: "#6d5a48",
  stageEdge: "#2c3430",
  riser: "#7d8790",
  riserEdge: "#5d666d",
  seat: "#2f6f5e",
  seatBack: "#265a4c",
  seatFrame: "#3b4842",
  felt: "#6f7d78",
  wash: "#ffe9c2",
  step: "#f6d48c",
};

export function auditoriumParts(room: Room, layout: Auditorium): { matte: Part[]; glow: Part[] } {
  const matte: Part[] = [];
  const glow: Part[] = [];
  const { x0, x1, z0, z1 } = rectEdges(room.rect);
  const { stage, stageStep, rows, rowSpan, seats, lectern, screen, rail } = layout;
  const add = (color: string, geometry: Part["geometry"]) => matte.push({ color, geometry });

  // The stage: a wooden deck with a dark lip, and its step by the aisle.
  const [sx, sy, sz] = stage.center;
  add(AUDITORIUM.stage, box(stage.half[0] * 2, stage.half[1] * 2, stage.half[2] * 2, { at: [sx, sy, sz] }));
  add(AUDITORIUM.stageEdge, box(0.04, stage.half[1] * 2, stage.half[2] * 2, { at: [sx + stage.half[0] + 0.02, sy, sz] }));
  add(AUDITORIUM.stage, box(stageStep.half[0] * 2, stageStep.half[1] * 2, stageStep.half[2] * 2, { at: stageStep.center }));

  // Risers: a carpeted deck per raised row, with a darker nosing and a step light on its face.
  for (const row of rows) {
    const depth = row.x1 - row.x0;
    const width = rowSpan.z1 - rowSpan.z0;
    const z = (rowSpan.z0 + rowSpan.z1) / 2;
    if (row.height > 0) {
      add(AUDITORIUM.riser, box(depth, row.height, width, { at: [(row.x0 + row.x1) / 2, row.height / 2, z] }));
      add(AUDITORIUM.riserEdge, box(0.06, 0.03, width, { at: [row.x0 + 0.03, row.height + 0.015, z] }));
      // A small light at the lane end of each step.
      glow.push({ color: AUDITORIUM.step, geometry: box(0.012, 0.04, 0.5, { at: [row.x0 - 0.006, row.height - 0.06, rowSpan.z1 - LANE / 2] }) });
    }
  }

  // Chairs: a pedestal, a seat pan and a back, facing the screen (west).
  for (const seat of seats) {
    const [x, y, z] = seat.position;
    add(AUDITORIUM.seatFrame, cylinder(0.05, 0.08, 0.36, 6, { at: [x, y + 0.18, z] }));
    add(AUDITORIUM.seat, box(0.5, 0.1, 0.5, { at: [x - 0.02, y + 0.42, z] }));
    add(AUDITORIUM.seatBack, box(0.09, 0.56, 0.5, { at: [x + 0.24, y + 0.74, z], rot: [0, 0, -0.12] }));
    add(AUDITORIUM.seatFrame, box(0.42, 0.05, 0.06, { at: [x + 0.02, y + 0.62, z - 0.29] }));
  }

  // The rail above the cross-aisle: posts and a top bar.
  const [rx, , rz] = rail.center;
  const railTop = rail.center[1] + rail.half[1];
  const railBase = rail.center[1] - rail.half[1];
  add(OFFICE.metal, box(0.06, 0.05, rail.half[2] * 2, { at: [rx, railTop, rz] }));
  for (let z = rowSpan.z0 + 0.3; z <= rowSpan.z1; z += 1.6) {
    add(OFFICE.metal, box(0.05, railTop - railBase, 0.05, { at: [rx, (railTop + railBase) / 2, z] }));
  }

  // The lectern: a wooden body with a green front panel and a slanted top.
  const [lx, ly, lz] = lectern.position;
  const turn: [number, number, number] = [0, lectern.yaw - Math.PI / 2, 0];
  add(OFFICE.wood, box(0.55, 1.05, 0.5, { at: [lx, ly + 0.525, lz], rot: turn }));
  add(OFFICE.green, box(0.57, 0.5, 0.46, { at: [lx, ly + 0.55, lz], rot: turn }));
  add(OFFICE.woodDark, box(0.62, 0.05, 0.56, { at: [lx, ly + 1.08, lz], rot: [0, turn[1], 0.15], order: "YXZ" }));

  // The screen's frame and two speakers beside it.
  const [, cy, cz] = screen.center;
  add(OFFICE.dark, box(SCREEN_FRAME.depth, screen.height + 0.16, screen.width + 0.16, { at: [x0 + SCREEN_FRAME.offset, cy, cz] }));
  for (const side of [-1, 1]) {
    add(OFFICE.dark, box(0.3, 0.9, 0.42, { at: [x0 + 0.25, 2.35, cz + side * (screen.width / 2 + 0.75)] }));
    add("#3c4440", cylinder(0.12, 0.12, 0.02, 10, { at: [x0 + 0.41, 2.45, cz + side * (screen.width / 2 + 0.75)], rot: [0, 0, Math.PI / 2] }));
  }

  // Felt acoustic panels along the north and south walls, with a warm wash light above each.
  for (const [z, inward] of [
    [z0 + 0.11, 1],
    [z1 - 0.11, -1],
  ] as const) {
    for (let x = x0 + 3.5; x < x1 - 1.5; x += 2.6) {
      add(AUDITORIUM.felt, box(1.6, 1.5, 0.05, { at: [x, 1.55, z] }));
      glow.push({ color: AUDITORIUM.wash, geometry: box(0.5, 0.06, 0.06, { at: [x, 2.7, z + inward * 0.04] }) });
    }
  }

  return { matte, glow };
}
