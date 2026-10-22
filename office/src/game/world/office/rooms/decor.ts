import type { Decor } from "@/content/room-themes";
import { mixHex } from "../../city/lighting";
import { beam, box, cylinder, flat, ico, type Part, sphere, torus } from "../../city/merge";
import { mulberry32, pick, range } from "../../city/random";
import { expertLocal, type RoomFrame, type Vec3 } from "../floorplan";
import { OFFICE } from "../palette";

/**
 * A department room's furniture as data (phase O6 › Rooms), in the room's own frame
 * (`floorplan.roomFrame`): the door is on the -x wall (glass, on the corridor), the far wall is at
 * +x, z runs along the room. Pure, so the tests can check that nothing blocks the door or the
 * expert. Static parts become one vertex-coloured mesh (`parts`) plus one for screens and LEDs
 * that glow (`glow`); `panels` are painted canvases (textures.ts), `leds` and `clocks` animate.
 */
export type LocalBox = { center: Vec3; half: Vec3 };
/** A painted plane: `yaw` turns its face (+z) towards the room. */
export type Panel = { id: PanelId; at: Vec3; yaw: number; size: [number, number] };
export type PanelId =
  | "screen"
  | "people"
  | "calendar"
  | "poster-it"
  | "chart-bars"
  | "chart-line"
  | "blueprint"
  | "recycling"
  | "poster-speakup"
  | "map"
  | "clock-labels"
  | "whiteboard";
export type Clock = { at: Vec3; yaw: number; radius: number };

export type RoomDecor = {
  parts: Part[];
  glow: Part[];
  colliders: LocalBox[];
  panels: Panel[];
  /** Server-rack LEDs (IT), facing +z. */
  leds: Vec3[];
  /** Time-zone clocks (International), facing -z. */
  clocks: Clock[];
};

export type DecorOptions = {
  /** International: one clock per office (max 6). */
  offices?: number;
};

/** Faces of the walls, for planes: far wall faces -x, north (z-) faces +z, south (z+) faces -z. */
const FACE = { far: -Math.PI / 2, north: 0, south: Math.PI };
const CARDBOARD = ["#c9a36a", "#b48a60", "#d7b98a", "#bf9765"];
const BOOKS = ["#5e3a5c", "#2c3e63", "#6f4a8e", "#8a6646", "#3b4842", "#9c4535", "#d9cfbd", "#2f5d47"];
const RACK = "#2a3036";

type Builder = {
  add: (color: string, geometry: Part["geometry"]) => void;
  glow: (color: string, geometry: Part["geometry"]) => void;
  collide: (center: Vec3, half: Vec3) => void;
  panel: (id: PanelId, at: Vec3, yaw: number, size: [number, number]) => void;
  out: RoomDecor;
};

function builder(): Builder {
  const out: RoomDecor = { parts: [], glow: [], colliders: [], panels: [], leds: [], clocks: [] };
  return {
    add: (color, geometry) => out.parts.push({ color, geometry }),
    glow: (color, geometry) => out.glow.push({ color, geometry }),
    collide: (center, half) => out.colliders.push({ center, half }),
    panel: (id, at, yaw, size) => out.panels.push({ id, at, yaw, size }),
    out,
  };
}

// --- shared pieces --------------------------------------------------------------------------

function plant(b: Builder, x: number, z: number, scale = 1) {
  b.add(OFFICE.pot, cylinder(0.2 * scale, 0.16 * scale, 0.42 * scale, 7, { at: [x, 0.21 * scale, z] }));
  b.add(OFFICE.plant, ico(0.36 * scale, 0, { at: [x, 0.78 * scale, z], scale: [1, 1.25, 1] }));
  b.add(mixHex(OFFICE.plant, "#1f3a26", 0.3), ico(0.24 * scale, 0, { at: [x + 0.12 * scale, 1.12 * scale, z - 0.06 * scale] }));
  b.collide([x, 0.5 * scale, z], [0.22 * scale, 0.5 * scale, 0.22 * scale]);
}

function tableLegs(b: Builder, x: number, z: number, w: number, d: number, h: number, color: string) {
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.add(color, box(0.05, h, 0.05, { at: [x + sx * (w / 2 - 0.06), h / 2, z + sz * (d / 2 - 0.06)] }));
  }
}

/** An office chair; `yaw` turns the backrest to the far side. */
function officeChair(b: Builder, x: number, z: number, yaw: number) {
  const back = (d: number): [number, number] => [x - Math.sin(yaw) * d, z - Math.cos(yaw) * d];
  b.add(OFFICE.dark, cylinder(0.26, 0.26, 0.04, 5, { at: [x, 0.06, z] }));
  b.add(OFFICE.metal, cylinder(0.03, 0.03, 0.36, 5, { at: [x, 0.26, z] }));
  b.add(OFFICE.dark, box(0.5, 0.08, 0.5, { at: [x, 0.48, z], rot: [0, yaw, 0] }));
  const [bx, bz] = back(0.24);
  b.add(OFFICE.dark, box(0.46, 0.5, 0.06, { at: [bx, 0.8, bz], rot: [0, yaw, 0] }));
  b.collide([x, 0.45, z], [0.27, 0.45, 0.27]);
}

/** A point `inset` in front of a wall's inner face (`hw`/`hd` are the inner half-sizes). */
function onWall(wall: keyof typeof FACE, along: number, y: number, inset: number, hw: number, hd: number): Vec3 {
  return wall === "far" ? [hw - inset, y, along] : wall === "north" ? [along, y, -hd + inset] : [along, y, hd - inset];
}

/**
 * A painted panel on a wall, in front of an optional frame: the frame's back is on the wall
 * (3 cm deep), the panel 5 mm in front of it.
 */
function wallPanel(b: Builder, id: PanelId, wall: keyof typeof FACE, along: number, y: number, size: [number, number], hw: number, hd: number, frame: string | null = OFFICE.dark, border = 0.05) {
  const [w, h] = size;
  const depth = 0.03;
  if (frame) {
    const at = onWall(wall, along, y, depth / 2, hw, hd);
    const geometry = wall === "far" ? box(depth, h + border * 2, w + border * 2, { at }) : box(w + border * 2, h + border * 2, depth, { at });
    b.add(frame, geometry);
  }
  b.panel(id, onWall(wall, along, y, frame ? depth + 0.005 : 0.008, hw, hd), FACE[wall], size);
}

/** Every room: a rug in the accent, the expert's desk and monitor, the wall screen. */
function common(b: Builder, accent: string, hw: number, hd: number) {
  const rug = mixHex(accent, "#f3f1ea", 0.55);
  b.add(mixHex(accent, "#f3f1ea", 0.3), flat(3.6, 4.8, -0.3, 0.008, 0));
  b.add(rug, flat(3.3, 4.5, -0.3, 0.014, 0));

  // The expert's desk against the far wall, behind where they stand.
  const dx = hw - 0.36;
  const dz = -1.55;
  b.add(OFFICE.wood, box(0.72, 0.05, 1.6, { at: [dx, 0.76, dz] }));
  tableLegs(b, dx, dz, 0.72, 1.6, 0.74, OFFICE.dark);
  b.add(OFFICE.wood, box(0.6, 0.6, 0.45, { at: [dx, 0.33, dz - 0.5] }));
  b.add(OFFICE.dark, box(0.05, 0.36, 0.62, { at: [hw - 0.16, 1.05, dz + 0.2] }));
  b.add(OFFICE.dark, cylinder(0.03, 0.05, 0.16, 6, { at: [hw - 0.16, 0.86, dz + 0.2] }));
  b.glow(mixHex(accent, "#e8f0f4", 0.7), box(0.006, 0.31, 0.57, { at: [hw - 0.19, 1.05, dz + 0.2] }));
  b.add(OFFICE.paper, box(0.2, 0.012, 0.45, { at: [dx - 0.12, 0.79, dz + 0.2] }));
  b.add(OFFICE.paper, box(0.24, 0.03, 0.3, { at: [dx, 0.8, dz - 0.5] }));
  b.add(OFFICE.pot, cylinder(0.05, 0.045, 0.09, 6, { at: [dx + 0.05, 0.83, dz - 0.62] }));
  b.add(OFFICE.plant, ico(0.08, 0, { at: [dx + 0.05, 0.92, dz - 0.62] }));
  b.collide([dx, 0.4, dz], [0.36, 0.4, 0.8]);

  // The wall screen: the department, or the cited document while the PDF is open.
  wallPanel(b, "screen", "far", 1.25, 1.85, [2.2, 1.24], hw, hd, "#1c2320");
}

// --- the department sets ----------------------------------------------------------------------

function hr(b: Builder, hw: number, hd: number) {
  const sofa = "#b8734c";
  const sz = hd - 0.45;
  b.add(sofa, box(2.2, 0.42, 0.8, { at: [-0.6, 0.21, sz] }));
  b.add(sofa, box(2.2, 0.6, 0.2, { at: [-0.6, 0.6, hd - 0.12] }));
  for (const side of [-1, 1]) b.add(sofa, box(0.2, 0.62, 0.8, { at: [-0.6 + side * 1.1, 0.31, sz] }));
  for (const side of [-1, 1]) b.add(OFFICE.fabricWarm, box(0.96, 0.12, 0.6, { at: [-0.6 + side * 0.5, 0.48, sz + 0.02] }));
  b.add(OFFICE.fabric, box(0.4, 0.34, 0.12, { at: [-1.35, 0.68, hd - 0.28], rot: [0.2, 0.25, 0] }));
  b.collide([-0.6, 0.4, sz + 0.02], [1.2, 0.4, 0.43]);
  // Coffee table with magazines.
  const tz = hd - 1.4;
  b.add(OFFICE.wood, box(1.1, 0.05, 0.55, { at: [-0.6, 0.4, tz] }));
  tableLegs(b, -0.6, tz, 1.1, 0.55, 0.38, OFFICE.woodDark);
  b.add("#2f6f5e", box(0.28, 0.015, 0.2, { at: [-0.8, 0.435, tz], rot: [0, 0.2, 0] }));
  b.add("#c99a2e", box(0.28, 0.015, 0.2, { at: [-0.35, 0.435, tz + 0.04], rot: [0, -0.3, 0] }));
  b.collide([-0.6, 0.21, tz], [0.56, 0.21, 0.29]);

  // The people wall over a low sideboard, the leave calendar beside the screen.
  wallPanel(b, "people", "north", -1.0, 1.8, [3.2, 1.2], hw, hd, null);
  b.add(OFFICE.wood, box(2.8, 0.7, 0.45, { at: [-1.0, 0.35, -hd + 0.23] }));
  b.add(OFFICE.woodDark, box(2.84, 0.04, 0.48, { at: [-1.0, 0.72, -hd + 0.24] }));
  b.add(OFFICE.paper, cylinder(0.08, 0.1, 0.3, 8, { at: [-2.1, 0.89, -hd + 0.25] }));
  b.collide([-1.0, 0.36, -hd + 0.23], [1.42, 0.36, 0.23]);
  wallPanel(b, "calendar", "far", 3.05, 1.6, [1.25, 0.92], hw, hd, "#b8956a");

  plant(b, -hw + 0.42, -hd + 0.42, 1.15);
  plant(b, hw - 0.42, hd - 0.42);
  plant(b, 1.0, hd - 0.42, 0.85);
}

function it(b: Builder, hw: number, hd: number) {
  // Two server racks with vents and blinking LEDs.
  const front = -hd + 0.9;
  for (const x of [0.15, 1.0]) {
    b.add(RACK, box(0.8, 2.05, 0.9, { at: [x, 1.025, -hd + 0.45] }));
    for (let row = 0; row < 9; row++) {
      const y = 0.25 + row * 0.2;
      b.add("#3b444b", box(0.66, 0.11, 0.012, { at: [x - 0.02, y, front + 0.006] }));
      for (let k = 0; k < 3; k++) b.out.leds.push([x + 0.25 + k * 0.035, y, front + 0.016]);
    }
  }
  b.collide([0.575, 1.03, -hd + 0.45], [0.85, 1.03, 0.45]);
  // A cable tray along the top of the north wall, dropping into the racks.
  b.add(OFFICE.metal, box(5.2, 0.05, 0.3, { at: [-0.9, 2.7, -hd + 0.2] }));
  for (const [i, color] of ["#3d6fb0", "#e0b43c", "#8b9591"].entries()) {
    b.add(color, box(5.1, 0.03, 0.05, { at: [-0.9, 2.74, -hd + 0.1 + i * 0.07] }));
    b.add(color, beam([0.15 + i * 0.12, 2.73, -hd + 0.12 + i * 0.07], [0.15 + i * 0.12, 2.06, -hd + 0.2], 0.035));
  }

  // The multi-monitor desk on the south wall.
  const dz = hd - 0.42;
  b.add("#dfe2dd", box(2.6, 0.05, 0.75, { at: [-1.0, 0.75, dz] }));
  tableLegs(b, -1.0, dz, 2.6, 0.75, 0.73, OFFICE.dark);
  for (let k = -1; k <= 1; k++) {
    const mx = -1.0 + k * 0.68;
    const turn = -k * 0.22;
    b.add(OFFICE.dark, box(0.62, 0.38, 0.04, { at: [mx, 1.14, hd - 0.2], rot: [0, turn, 0] }));
    b.add(OFFICE.dark, cylinder(0.025, 0.06, 0.2, 6, { at: [mx, 0.88, hd - 0.18] }));
    b.glow(k === 0 ? "#6b9bd8" : "#4d7fbe", box(0.56, 0.32, 0.01, { at: [mx + Math.sin(turn) * -0.025, 1.14, hd - 0.225], rot: [0, turn, 0] }));
  }
  b.add(OFFICE.dark, box(0.5, 0.02, 0.16, { at: [-1.0, 0.785, dz - 0.15] }));
  b.add(OFFICE.dark, box(0.07, 0.02, 0.1, { at: [-0.6, 0.785, dz - 0.15] }));
  b.add("#9aa3a0", box(0.34, 0.03, 0.24, { at: [-2.0, 0.79, dz] }));
  b.collide([-1.0, 0.4, dz], [1.3, 0.4, 0.38]);
  officeChair(b, -1.0, hd - 1.2, Math.PI);

  wallPanel(b, "poster-it", "far", 3.05, 1.6, [0.92, 1.25], hw, hd, null);
  plant(b, -hw + 0.42, -hd + 0.42, 1.1);
  plant(b, hw - 0.42, hd - 0.42, 0.9);
}

function finance(b: Builder, hw: number, hd: number) {
  // Two screens of charts over a credenza of ledgers.
  wallPanel(b, "chart-bars", "north", -2.0, 1.85, [1.8, 1.0], hw, hd, "#1c2320");
  wallPanel(b, "chart-line", "north", 0.1, 1.85, [1.8, 1.0], hw, hd, "#1c2320");
  b.add(OFFICE.woodDark, box(3.8, 0.75, 0.45, { at: [-0.95, 0.375, -hd + 0.225] }));
  b.add(OFFICE.wood, box(3.84, 0.04, 0.48, { at: [-0.95, 0.77, -hd + 0.24] }));
  const random = mulberry32(7);
  let x = -2.7;
  while (x < 0.4) {
    const width = range(random, 0.06, 0.1);
    const height = range(random, 0.26, 0.34);
    b.add(pick(random, ["#2f5d47", "#7a2e2a", "#2c3e63", "#c9a36a", "#3b4842"]), box(width, height, 0.24, { at: [x + width / 2, 0.79 + height / 2, -hd + 0.2] }));
    x += width + 0.012;
    if (random() < 0.12) x += 0.25;
  }
  b.collide([-0.95, 0.4, -hd + 0.225], [1.9, 0.4, 0.225]);

  // The safe in the corner, its door to the room.
  const sx = hw - 0.45;
  const sz = hd - 0.48;
  b.add("#4a5150", box(0.8, 0.95, 0.78, { at: [sx, 0.475, sz] }));
  b.add("#5b6362", box(0.02, 0.8, 0.64, { at: [sx - 0.41, 0.48, sz] }));
  b.add("#c9a648", cylinder(0.09, 0.09, 0.04, 12, { at: [sx - 0.43, 0.6, sz], rot: [0, 0, Math.PI / 2] }));
  b.add(OFFICE.metal, box(0.03, 0.04, 0.24, { at: [sx - 0.43, 0.36, sz] }));
  b.collide([sx, 0.48, sz], [0.4, 0.48, 0.4]);

  // A work table with calculators and paper.
  const tz = hd - 0.4;
  b.add(OFFICE.wood, box(2.4, 0.05, 0.7, { at: [-1.1, 0.74, tz] }));
  tableLegs(b, -1.1, tz, 2.4, 0.7, 0.72, OFFICE.dark);
  for (const [cx, turn] of [[-1.7, 0.2], [-0.5, -0.15]]) {
    b.add("#dcdfda", box(0.17, 0.03, 0.23, { at: [cx, 0.78, tz - 0.05], rot: [0, turn, 0] }));
    b.add(OFFICE.dark, box(0.13, 0.008, 0.12, { at: [cx, 0.797, tz - 0.01], rot: [0, turn, 0] }));
    b.glow("#a8d8b0", box(0.12, 0.008, 0.04, { at: [cx - Math.sin(turn) * 0.08, 0.797, tz - 0.13], rot: [0, turn, 0] }));
  }
  for (let k = 0; k < 4; k++) b.add(k % 2 ? OFFICE.paper : "#eceee8", box(0.3, 0.012, 0.4, { at: [-1.1, 0.772 + k * 0.012, tz + 0.02], rot: [0, k * 0.08, 0] }));
  b.collide([-1.1, 0.38, tz], [1.2, 0.38, 0.36]);
  officeChair(b, -1.1, hd - 1.15, Math.PI);

  plant(b, -hw + 0.42, -hd + 0.42, 1.1);
  plant(b, 1.0, hd - 0.42, 0.85);
}

function procurement(b: Builder, hw: number, hd: number) {
  // Parcel shelving along the north wall.
  const random = mulberry32(11);
  for (const ux of [-2.45, -0.65]) {
    for (const px of [-0.85, 0.85]) b.add(OFFICE.metal, box(0.05, 2.15, 0.05, { at: [ux + px, 1.075, -hd + 0.05] }));
    for (const px of [-0.85, 0.85]) b.add(OFFICE.metal, box(0.05, 2.15, 0.05, { at: [ux + px, 1.075, -hd + 0.5] }));
    for (const y of [0.12, 0.62, 1.12, 1.62, 2.1]) {
      b.add("#7d8682", box(1.75, 0.04, 0.52, { at: [ux, y, -hd + 0.27] }));
      if (y > 2) continue;
      let x = ux - 0.8;
      while (x < ux + 0.7) {
        const w = range(random, 0.22, 0.42);
        const h = range(random, 0.18, 0.4);
        const d = range(random, 0.3, 0.46);
        if (x + w > ux + 0.82) break;
        const color = pick(random, CARDBOARD);
        b.add(color, box(w, h, d, { at: [x + w / 2, y + 0.02 + h / 2, -hd + 0.27] }));
        b.add("#e8dcc0", box(w + 0.004, 0.035, 0.08, { at: [x + w / 2, y + 0.02 + h, -hd + 0.27] }));
        x += w + range(random, 0.02, 0.08);
      }
    }
  }
  b.collide([-1.55, 1.08, -hd + 0.27], [1.8, 1.08, 0.27]);

  // A pallet of boxes.
  const px = -1.4;
  const pz = hd - 0.85;
  for (let k = -2; k <= 2; k++) b.add(OFFICE.wood, box(1.2, 0.03, 0.14, { at: [px, 0.135, pz + k * 0.21] }));
  for (const bx of [-0.5, 0, 0.5]) for (const bz of [-0.42, 0, 0.42]) b.add(OFFICE.woodDark, box(0.12, 0.1, 0.12, { at: [px + bx, 0.07, pz + bz] }));
  for (const [bx, bz] of [[-0.29, -0.23], [0.29, -0.23], [-0.29, 0.24], [0.29, 0.24]]) {
    const color = pick(random, CARDBOARD);
    b.add(color, box(0.56, 0.46, 0.45, { at: [px + bx, 0.38, pz + bz] }));
    b.add("#e8dcc0", box(0.08, 0.465, 0.452, { at: [px + bx, 0.38, pz + bz] }));
  }
  b.add(pick(random, CARDBOARD), box(0.6, 0.42, 0.5, { at: [px + 0.05, 0.82, pz], rot: [0, 0.12, 0] }));
  b.collide([px, 0.55, pz], [0.62, 0.55, 0.52]);

  // The catalogue stand.
  const cx = 0.9;
  const cz = hd - 0.55;
  b.add(OFFICE.dark, cylinder(0.25, 0.25, 0.03, 10, { at: [cx, 0.015, cz] }));
  b.add(OFFICE.metal, cylinder(0.025, 0.025, 1.0, 6, { at: [cx, 0.5, cz] }));
  b.add(OFFICE.dark, box(0.75, 0.62, 0.05, { at: [cx, 1.15, cz], rot: [-0.3, 0, 0] }));
  for (const [i, color] of ["#c08a24", "#2c3e63", "#2f6f5e"].entries()) {
    b.add(color, box(0.2, 0.28, 0.02, { at: [cx - 0.24 + i * 0.24, 1.17, cz - 0.04], rot: [-0.3, 0, 0] }));
    b.add(OFFICE.paper, box(0.14, 0.03, 0.021, { at: [cx - 0.24 + i * 0.24, 1.25, cz - 0.07], rot: [-0.3, 0, 0] }));
  }
  b.collide([cx, 0.6, cz], [0.38, 0.6, 0.2]);

  plant(b, -hw + 0.42, hd - 0.42);
  plant(b, hw - 0.42, hd - 0.42, 1.1);
}

function facilities(b: Builder, hw: number, hd: number) {
  // A workbench under a pegboard of tools, with rolled blueprints.
  const wx = -1.6;
  b.add(OFFICE.wood, box(2.6, 0.06, 0.7, { at: [wx, 0.88, -hd + 0.36] }));
  tableLegs(b, wx, -hd + 0.36, 2.6, 0.7, 0.86, OFFICE.dark);
  b.add(OFFICE.woodDark, box(2.5, 0.03, 0.6, { at: [wx, 0.25, -hd + 0.36] }));
  b.add("#c9b48a", box(2.6, 1.1, 0.03, { at: [wx, 1.75, -hd + 0.015] }));
  const z = -hd + 0.045;
  // Hammer, wrench, screwdrivers, saw, pliers.
  b.add(OFFICE.woodDark, box(0.04, 0.32, 0.02, { at: [wx - 1.0, 1.7, z] }));
  b.add(OFFICE.metal, box(0.15, 0.05, 0.04, { at: [wx - 1.0, 1.86, z] }));
  b.add(OFFICE.metal, box(0.035, 0.3, 0.015, { at: [wx - 0.65, 1.75, z], rot: [0, 0, 0.15] }));
  b.add(OFFICE.metal, torus(0.035, 0.012, 4, 8, Math.PI * 1.6, { at: [wx - 0.67, 1.91, z] }));
  for (const [k, color] of ["#b23a2e", "#e0b43c", "#3d6fb0"].entries()) {
    const sx = wx - 0.3 + k * 0.12;
    b.add(color, cylinder(0.02, 0.022, 0.1, 6, { at: [sx, 1.92, z] }));
    b.add(OFFICE.metal, cylinder(0.006, 0.006, 0.16, 4, { at: [sx, 1.79, z] }));
  }
  b.add(OFFICE.metal, box(0.44, 0.13, 0.01, { at: [wx + 0.35, 1.6, z] }));
  b.add(OFFICE.woodDark, box(0.12, 0.12, 0.03, { at: [wx + 0.62, 1.62, z] }));
  b.add("#b23a2e", box(0.03, 0.18, 0.02, { at: [wx + 0.95, 1.8, z], rot: [0, 0, 0.2] }));
  b.add("#b23a2e", box(0.03, 0.18, 0.02, { at: [wx + 1.0, 1.8, z], rot: [0, 0, -0.2] }));
  b.add("#a9c3dd", cylinder(0.04, 0.04, 0.9, 8, { at: [wx - 0.3, 0.95, -hd + 0.45], rot: [0, 0, Math.PI / 2] }));
  b.add("#c7d8e8", cylinder(0.035, 0.035, 0.8, 8, { at: [wx - 0.25, 0.95, -hd + 0.55], rot: [0, 0.2, Math.PI / 2] }));
  b.add("#e0b43c", cylinder(0.06, 0.06, 0.05, 10, { at: [wx + 0.7, 0.935, -hd + 0.4] }));
  b.collide([wx, 0.46, -hd + 0.36], [1.3, 0.46, 0.36]);

  // The maintenance cart, with a bucket and a mop, and a wet-floor sign.
  const cx = 0.7;
  const cz = hd - 0.65;
  for (const y of [0.25, 0.78]) b.add("#2a8580", box(0.95, 0.04, 0.52, { at: [cx, y, cz] }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.add(OFFICE.metal, box(0.03, 0.78, 0.03, { at: [cx + sx * 0.45, 0.48, cz + sz * 0.24] }));
    b.add(OFFICE.dark, cylinder(0.06, 0.06, 0.04, 8, { at: [cx + sx * 0.4, 0.06, cz + sz * 0.22], rot: [Math.PI / 2, 0, 0] }));
  }
  b.add(OFFICE.metal, beam([cx + 0.48, 0.8, cz - 0.24], [cx + 0.62, 1.05, cz - 0.24], 0.025));
  b.add(OFFICE.metal, beam([cx + 0.48, 0.8, cz + 0.24], [cx + 0.62, 1.05, cz + 0.24], 0.025));
  b.add(OFFICE.metal, beam([cx + 0.62, 1.05, cz - 0.25], [cx + 0.62, 1.05, cz + 0.25], 0.03));
  b.add("#e0b43c", cylinder(0.17, 0.14, 0.3, 10, { at: [cx - 0.2, 0.42, cz] }));
  b.add("#3d6fb0", cylinder(0.05, 0.05, 0.22, 6, { at: [cx + 0.2, 0.91, cz - 0.1] }));
  b.add("#f9fcfa", cylinder(0.045, 0.045, 0.18, 6, { at: [cx + 0.05, 0.89, cz + 0.1] }));
  b.add(OFFICE.woodDark, beam([cx - 0.2, 0.45, cz], [cx - 0.42, 1.55, cz - 0.1], 0.03));
  b.add("#d9cfbd", box(0.3, 0.1, 0.16, { at: [cx - 0.2, 0.42, cz] }));
  b.collide([cx, 0.5, cz], [0.55, 0.5, 0.3]);
  b.add("#e0b43c", box(0.32, 0.6, 0.02, { at: [cx - 1.0, 0.3, cz + 0.08], rot: [0.28, 0, 0] }));
  b.add("#e0b43c", box(0.32, 0.6, 0.02, { at: [cx - 1.0, 0.3, cz - 0.08], rot: [-0.28, 0, 0] }));

  // Blueprints beside the screen; the recycling station on the south wall.
  wallPanel(b, "blueprint", "far", 3.05, 1.6, [1.3, 0.95], hw, hd, OFFICE.dark);
  const rx = -2.4;
  for (const [k, color] of ["#3d6fb0", "#c08a24", "#4d7d4f"].entries()) {
    const bx = rx - 0.62 + k * 0.62;
    b.add(color, box(0.56, 0.8, 0.5, { at: [bx, 0.4, hd - 0.3] }));
    b.add(mixHex(color, "#1c2320", 0.35), box(0.58, 0.05, 0.52, { at: [bx, 0.82, hd - 0.3] }));
    b.add(OFFICE.dark, box(0.3, 0.012, 0.06, { at: [bx, 0.85, hd - 0.38] }));
  }
  b.collide([rx, 0.42, hd - 0.3], [0.92, 0.42, 0.27]);
  wallPanel(b, "recycling", "south", rx, 1.35, [1.86, 0.42], hw, hd, null);

  plant(b, hw - 0.42, hd - 0.42);
}

function compliance(b: Builder, hw: number, hd: number) {
  // Bookshelves along the north wall.
  const random = mulberry32(23);
  for (const ux of [-2.5, -0.7]) {
    b.add(OFFICE.woodDark, box(1.7, 2.2, 0.06, { at: [ux, 1.1, -hd + 0.03] }));
    for (const side of [-1, 1]) b.add(OFFICE.woodDark, box(0.05, 2.2, 0.4, { at: [ux + side * 0.83, 1.1, -hd + 0.2] }));
    for (const y of [0.05, 0.55, 1.05, 1.55, 2.17]) b.add(OFFICE.woodDark, box(1.7, 0.04, 0.4, { at: [ux, y, -hd + 0.2] }));
    for (const y of [0.07, 0.57, 1.07, 1.57]) {
      let x = ux - 0.78;
      while (x < ux + 0.75) {
        const w = range(random, 0.045, 0.085);
        const h = range(random, 0.3, 0.42);
        if (x + w > ux + 0.79) break;
        const lean = random() < 0.08 ? 0.18 : 0;
        b.add(pick(random, BOOKS), box(w, h, range(random, 0.24, 0.32), { at: [x + w / 2, y + h / 2 + 0.02, -hd + 0.2], rot: [0, 0, lean] }));
        x += w + 0.008 + (lean ? 0.06 : 0);
        if (random() < 0.05) x += 0.2;
      }
    }
  }
  b.collide([-1.6, 1.1, -hd + 0.2], [1.75, 1.1, 0.2]);

  // The scales of justice on a plinth.
  const sx = 0.6;
  const sz = hd - 0.75;
  const gold = "#c9a648";
  b.add("#e4e2da", box(0.55, 0.95, 0.55, { at: [sx, 0.475, sz] }));
  b.add(gold, cylinder(0.12, 0.15, 0.05, 10, { at: [sx, 0.975, sz] }));
  b.add(gold, cylinder(0.025, 0.03, 0.62, 8, { at: [sx, 1.3, sz] }));
  b.add(gold, sphere(0.045, 8, 6, { at: [sx, 1.64, sz] }));
  // The beam runs along the wall (z), square to the view from the door, slightly out of balance.
  b.add(gold, box(0.035, 0.035, 0.92, { at: [sx, 1.58, sz], rot: [0.05, 0, 0] }));
  for (const [side, drop] of [[-1, 0.03], [1, -0.03]]) {
    const end: Vec3 = [sx, 1.58 - side * 0.023, sz + side * 0.45];
    const pan: Vec3 = [sx, 1.24 + drop, sz + side * 0.45];
    for (const dz of [-0.1, 0.1]) b.add(gold, beam(end, [pan[0], pan[1] + 0.02, pan[2] + dz], 0.014));
    b.add(gold, cylinder(0.15, 0.09, 0.04, 12, { at: pan }));
  }
  b.collide([sx, 0.48, sz], [0.28, 0.48, 0.28]);

  // Two armchairs and a side table.
  const fabric = "#6f5a7e";
  for (const ax of [-2.7, -1.3]) {
    const az = hd - 0.6;
    b.add(fabric, box(0.75, 0.4, 0.7, { at: [ax, 0.24, az] }));
    b.add(fabric, box(0.75, 0.5, 0.16, { at: [ax, 0.65, az + 0.27] }));
    for (const side of [-1, 1]) b.add(mixHex(fabric, "#1c2320", 0.2), box(0.12, 0.5, 0.7, { at: [ax + side * 0.36, 0.3, az] }));
    b.collide([ax, 0.4, az], [0.4, 0.4, 0.36]);
  }
  b.add(OFFICE.wood, cylinder(0.24, 0.24, 0.04, 10, { at: [-2.0, 0.52, hd - 0.55] }));
  b.add(OFFICE.dark, cylinder(0.03, 0.03, 0.5, 6, { at: [-2.0, 0.26, hd - 0.55] }));

  wallPanel(b, "poster-speakup", "far", 3.05, 1.6, [0.92, 1.25], hw, hd, null);
  plant(b, hw - 0.42, hd - 0.42);
  plant(b, -hw + 0.42, -hd + 0.42, 0.9);
}

function international(b: Builder, hw: number, hd: number, offices: number) {
  // The world map with the offices pinned (painted), over a low cabinet.
  wallPanel(b, "map", "north", -1.0, 1.8, [4.4, 2.2], hw, hd, OFFICE.woodDark);
  b.add(OFFICE.woodDark, box(3.2, 0.6, 0.42, { at: [-1.0, 0.3, -hd + 0.21] }));
  b.add("#e8dcc0", box(0.34, 0.24, 0.26, { at: [-2.1, 0.72, -hd + 0.22] }));
  b.collide([-1.0, 0.3, -hd + 0.21], [1.6, 0.3, 0.21]);

  // A row of time-zone clocks on the south wall, one per office, the cities painted under them.
  const count = Math.max(1, Math.min(6, offices));
  const spacing = 0.9;
  const start = -0.8 - ((count - 1) * spacing) / 2;
  for (let k = 0; k < count; k++) {
    const cx = start + k * spacing;
    b.add(OFFICE.dark, cylinder(0.32, 0.32, 0.04, 20, { at: [cx, 2.05, hd - 0.03], rot: [Math.PI / 2, 0, 0] }));
    b.add(OFFICE.paper, cylinder(0.29, 0.29, 0.02, 20, { at: [cx, 2.05, hd - 0.055], rot: [Math.PI / 2, 0, 0] }));
    b.out.clocks.push({ at: [cx, 2.05, hd - 0.07], yaw: Math.PI, radius: 0.29 });
  }
  wallPanel(b, "clock-labels", "south", -0.8, 1.6, [count * spacing, 0.3], hw, hd, null);

  // A bench with a suitcase, and a floor globe.
  b.add(OFFICE.woodDark, box(1.8, 0.06, 0.42, { at: [-0.8, 0.45, hd - 0.3] }));
  tableLegs(b, -0.8, hd - 0.3, 1.8, 0.42, 0.43, OFFICE.dark);
  b.add("#b0892e", box(0.5, 0.36, 0.22, { at: [-1.2, 0.66, hd - 0.3] }));
  b.add(OFFICE.dark, box(0.18, 0.04, 0.03, { at: [-1.2, 0.86, hd - 0.3] }));
  b.add("#2c3e63", box(0.4, 0.62, 0.24, { at: [-2.2, 0.33, hd - 0.35] }));
  b.add(OFFICE.metal, box(0.03, 0.2, 0.03, { at: [-2.2, 0.74, hd - 0.35] }));
  b.collide([-1.2, 0.38, hd - 0.3], [1.25, 0.38, 0.24]);
  const gx = 1.0;
  const gz = -hd + 0.75;
  for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    b.add(OFFICE.woodDark, beam([gx, 0.55, gz], [gx + Math.cos(angle) * 0.3, 0, gz + Math.sin(angle) * 0.3], 0.03));
  }
  b.add("#3d6fb0", ico(0.3, 2, { at: [gx, 0.95, gz] }));
  b.add("#7aa36a", ico(0.305, 0, { at: [gx, 0.95, gz], rot: [0.4, 0.3, 0] }));
  b.add("#c9a648", torus(0.34, 0.012, 4, 20, Math.PI * 1.4, { at: [gx, 0.95, gz], rot: [0, Math.PI / 2, 0.4] }));
  b.collide([gx, 0.6, gz], [0.34, 0.6, 0.34]);

  plant(b, hw - 0.42, hd - 0.42);
  plant(b, -hw + 0.42, hd - 0.42, 1.1);
}

function generic(b: Builder, hw: number, hd: number) {
  // A meeting table with chairs, and a whiteboard.
  const tx = -0.6;
  const tz = 2.0;
  b.add(OFFICE.wood, box(2.4, 0.05, 1.05, { at: [tx, 0.74, tz] }));
  tableLegs(b, tx, tz, 2.4, 1.05, 0.72, OFFICE.dark);
  b.collide([tx, 0.38, tz], [1.2, 0.38, 0.53]);
  for (const cx of [-0.6, 0.6]) officeChair(b, tx + cx, tz + 0.85, 0);
  officeChair(b, tx - 1.55, tz, -Math.PI / 2);
  officeChair(b, tx + 1.55, tz, Math.PI / 2);
  b.add(OFFICE.paper, box(0.3, 0.012, 0.4, { at: [tx - 0.4, 0.772, tz - 0.1], rot: [0, 0.2, 0] }));
  wallPanel(b, "whiteboard", "north", -1.0, 1.6, [2.6, 1.2], hw, hd, "#aeb5b1");
  b.add("#aeb5b1", box(2.4, 0.04, 0.1, { at: [-1.0, 0.98, -hd + 0.06] }));
  plant(b, -hw + 0.42, -hd + 0.42, 1.1);
  plant(b, hw - 0.42, hd - 0.42);
}

/** The whole set for a room: the shared pieces plus the department's decor. */
export function roomDecor(decor: Decor, accent: string, frame: Pick<RoomFrame, "width" | "depth">, options: DecorOptions = {}): RoomDecor {
  const b = builder();
  const hw = frame.width / 2 - 0.1;
  const hd = frame.depth / 2 - 0.1;
  common(b, accent, hw, hd);
  if (decor === "hr") hr(b, hw, hd);
  else if (decor === "it") it(b, hw, hd);
  else if (decor === "finance") finance(b, hw, hd);
  else if (decor === "procurement") procurement(b, hw, hd);
  else if (decor === "facilities") facilities(b, hw, hd);
  else if (decor === "compliance") compliance(b, hw, hd);
  else if (decor === "international") international(b, hw, hd, options.offices ?? 6);
  else generic(b, hw, hd);
  return b.out;
}

/** Room-local spots the decor keeps clear: the doorway and the way to the expert (tests). */
export function keepClear(frame: Pick<RoomFrame, "width" | "depth">) {
  const [ex, , ez] = expertLocal(frame);
  return { door: { x: -frame.width / 2, z: 0, width: 1.6 }, expert: { x: ex, z: ez } };
}
