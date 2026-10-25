import { box, cylinder, ico, type Part, sphere } from "../../city/merge";
import { rectEdges, type Room } from "../floorplan";
import { OFFICE } from "../palette";
import type { PlayLayout } from "./layout";

/**
 * The play area's pieces as merged parts (phase O8 › Room): arcade cabinets, the jukebox, the
 * coffee counter, the table-tennis table, the sorting station with its conveyor and three bins,
 * beanbags and a rug. `matte` is lit; `glow` (screens, marquees, lamps) stays bright.
 */
export const PLAY = {
  cabinet: "#243b34",
  cabinetDeck: "#1b2a25",
  cabinetAlt: "#3a3f5c",
  screen: "#9fd8c3",
  marquee: "#cfeee0",
  tableTop: "#2c6e63",
  line: "#f2f2ee",
  belt: "#2c3430",
  beltStripe: "#4a5750",
  base: "#3b4842",
  paperBin: "#3d6fb0",
  recyclingBin: "#2f7d4f",
  generalBin: "#5e6a64",
  rug: "#5f8f7e",
  rugRing: "#9fc2b3",
  jukebox: "#7a3b2e",
  chrome: "#c4cbc7",
  warm: "#ffd9a0",
  beanbags: ["#2f6f5e", "#c9a36a", "#7a6fa8"],
  machine: "#2c3430",
  ok: "#7be0a7",
};

export function playParts(room: Room, layout: PlayLayout): { matte: Part[]; glow: Part[] } {
  const matte: Part[] = [];
  const glow: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => matte.push({ color, geometry });
  const shine = (color: string, geometry: Part["geometry"]) => glow.push({ color, geometry });
  const { z0 } = rectEdges(room.rect);

  // The rug under the beanbags: a disc with a lighter ring.
  const [rx, , rz] = layout.rug.center;
  add(PLAY.rug, cylinder(layout.rug.radius, layout.rug.radius, 0.02, 32, { at: [rx, 0.01, rz] }));
  add(PLAY.rugRing, cylinder(layout.rug.radius * 0.72, layout.rug.radius * 0.72, 0.024, 32, { at: [rx, 0.012, rz] }));
  add(PLAY.rug, cylinder(layout.rug.radius * 0.62, layout.rug.radius * 0.62, 0.028, 32, { at: [rx, 0.014, rz] }));

  // Arcade cabinets (they face west): body, control deck with buttons and a stick, screen, marquee.
  layout.arcade.forEach(({ position: [cx, , cz] }, index) => {
    const body = index === 0 ? PLAY.cabinet : PLAY.cabinetAlt;
    add(body, box(0.8, 1.9, 0.9, { at: [cx, 0.95, cz] }));
    add(PLAY.cabinetDeck, box(0.55, 0.1, 0.86, { at: [cx - 0.5, 0.95, cz] }));
    add(PLAY.cabinetDeck, box(0.03, 0.74, 0.8, { at: [cx - 0.4, 1.4, cz] }));
    add(PLAY.chrome, cylinder(0.014, 0.014, 0.12, 8, { at: [cx - 0.52, 1.04, cz - 0.22] }));
    add("#b7473a", sphere(0.04, 10, 8, { at: [cx - 0.52, 1.11, cz - 0.22] }));
    [0.04, 0.2, 0.34].forEach((dz, k) => add(["#b7473a", "#3d6fb0", "#f2f2ee"][k], cylinder(0.04, 0.04, 0.03, 10, { at: [cx - 0.5, 1.01, cz + dz] })));
    shine(PLAY.screen, box(0.02, 0.62, 0.7, { at: [cx - 0.42, 1.4, cz] }));
    shine(PLAY.marquee, box(0.05, 0.2, 0.88, { at: [cx - 0.38, 1.82, cz] }));
    // A kick plate and a side stripe.
    add(PLAY.cabinetDeck, box(0.82, 0.2, 0.92, { at: [cx, 0.1, cz] }));
  });

  // The jukebox (west-facing): a wooden body with a domed top, chrome trim and lit panels.
  const [jx, , jz] = layout.jukebox.position;
  add(PLAY.jukebox, box(0.7, 1.2, 0.9, { at: [jx, 0.6, jz] }));
  add(PLAY.jukebox, cylinder(0.45, 0.45, 0.7, 20, { at: [jx, 1.2, jz], rot: [0, 0, Math.PI / 2] }));
  add(PLAY.chrome, box(0.04, 1.1, 0.08, { at: [jx - 0.36, 0.6, jz - 0.42] }));
  add(PLAY.chrome, box(0.04, 1.1, 0.08, { at: [jx - 0.36, 0.6, jz + 0.42] }));
  add(PLAY.chrome, box(0.05, 0.1, 0.9, { at: [jx - 0.37, 0.12, jz] }));
  shine(PLAY.warm, box(0.03, 0.9, 0.12, { at: [jx - 0.355, 0.6, jz - 0.28] }));
  shine(PLAY.warm, box(0.03, 0.9, 0.12, { at: [jx - 0.355, 0.6, jz + 0.28] }));
  shine(PLAY.screen, box(0.03, 0.5, 0.34, { at: [jx - 0.355, 0.85, jz] }));
  shine(PLAY.warm, cylinder(0.3, 0.3, 0.02, 20, { at: [jx - 0.36, 1.25, jz], rot: [0, 0, Math.PI / 2] }));

  // The coffee counter: a wooden cabinet with a dark top, the machine, cups and a pot.
  const { counter, machine } = layout.coffee;
  const [cx, cy, cz] = counter.center;
  add(OFFICE.wood, box(counter.half[0] * 2, 0.88, counter.half[2] * 2, { at: [cx, 0.44, cz] }));
  add(OFFICE.woodDark, box(counter.half[0] * 2 + 0.04, 0.05, counter.half[2] * 2 + 0.04, { at: [cx, 0.9, cz] }));
  void cy;
  add(PLAY.machine, box(0.42, 0.56, 0.5, { at: [machine[0], machine[1] + 0.28, machine[2]] }));
  add(PLAY.chrome, box(0.44, 0.06, 0.52, { at: [machine[0], machine[1] + 0.59, machine[2]] }));
  add(PLAY.chrome, box(0.3, 0.03, 0.4, { at: [machine[0] - 0.08, machine[1] + 0.06, machine[2]] }));
  add(PLAY.chrome, cylinder(0.025, 0.025, 0.12, 8, { at: [machine[0] - 0.19, machine[1] + 0.34, machine[2] - 0.08] }));
  add(PLAY.chrome, cylinder(0.025, 0.025, 0.12, 8, { at: [machine[0] - 0.19, machine[1] + 0.34, machine[2] + 0.08] }));
  shine(PLAY.ok, box(0.015, 0.05, 0.05, { at: [machine[0] - 0.215, machine[1] + 0.48, machine[2] + 0.14] }));
  [-0.55, -0.4, 0.5].forEach((dz) => add(OFFICE.paper, cylinder(0.04, 0.03, 0.09, 10, { at: [machine[0] - 0.05, 0.945, machine[2] + dz] })));

  // Table tennis: the table, its lines, the net, legs and two paddles.
  const [tx, , tz] = layout.table.center;
  const { length, width, height } = layout.table;
  add(PLAY.tableTop, box(length, 0.04, width, { at: [tx, height - 0.02, tz] }));
  add(OFFICE.metal, box(length - 0.1, 0.06, width - 0.1, { at: [tx, height - 0.07, tz] }));
  for (const [dx, dz] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    add(OFFICE.metal, box(0.06, height - 0.08, 0.06, { at: [tx + dx * (length / 2 - 0.15), (height - 0.08) / 2, tz + dz * (width / 2 - 0.12)] }));
  }
  add(PLAY.line, box(length, 0.003, 0.02, { at: [tx, height + 0.002, tz - width / 2 + 0.012] }));
  add(PLAY.line, box(length, 0.003, 0.02, { at: [tx, height + 0.002, tz + width / 2 - 0.012] }));
  add(PLAY.line, box(0.02, 0.003, width, { at: [tx - length / 2 + 0.012, height + 0.002, tz] }));
  add(PLAY.line, box(0.02, 0.003, width, { at: [tx + length / 2 - 0.012, height + 0.002, tz] }));
  add(PLAY.line, box(length, 0.003, 0.008, { at: [tx, height + 0.002, tz] }));
  add("#e9ece8", box(0.012, 0.15, width + 0.2, { at: [tx, height + 0.08, tz] }));
  add(PLAY.chrome, box(0.03, 0.17, 0.03, { at: [tx, height + 0.085, tz - width / 2 - 0.1] }));
  add(PLAY.chrome, box(0.03, 0.17, 0.03, { at: [tx, height + 0.085, tz + width / 2 + 0.1] }));
  add("#b7473a", cylinder(0.09, 0.09, 0.012, 14, { at: [tx - length / 2 + 0.3, height + 0.008, tz + 0.3] }));
  add("#243b34", cylinder(0.09, 0.09, 0.012, 14, { at: [tx + length / 2 - 0.3, height + 0.008, tz - 0.25] }));
  shine("#fbfcfa", sphere(0.02, 8, 6, { at: [tx - 0.3, height + 0.02, tz + 0.1] }));

  // The sorting station along the south wall: a base, the conveyor belt with a few items on it,
  // and three bins at its end.
  const { conveyor, bins } = layout;
  const length2 = conveyor.x1 - conveyor.x0;
  const beltX = (conveyor.x0 + conveyor.x1) / 2;
  add(PLAY.base, box(length2 + 0.2, 0.62, 0.9, { at: [beltX, 0.31, conveyor.z] }));
  add(PLAY.belt, box(length2, 0.06, 0.62, { at: [beltX, 0.65, conveyor.z - 0.02] }));
  for (let x = conveyor.x0 + 0.25; x < conveyor.x1 - 0.1; x += 0.5) add(PLAY.beltStripe, box(0.14, 0.064, 0.62, { at: [x, 0.652, conveyor.z - 0.02] }));
  add(PLAY.chrome, cylinder(0.05, 0.05, 0.66, 10, { at: [conveyor.x0, 0.66, conveyor.z - 0.02], rot: [Math.PI / 2, 0, 0] }));
  add(PLAY.chrome, cylinder(0.05, 0.05, 0.66, 10, { at: [conveyor.x1, 0.66, conveyor.z - 0.02], rot: [Math.PI / 2, 0, 0] }));
  add("#f2f2ee", box(0.2, 0.012, 0.26, { at: [conveyor.x0 + 0.9, 0.7, conveyor.z - 0.1], rot: [0, 0.3, 0] }));
  add("#aeb6b2", cylinder(0.04, 0.04, 0.12, 10, { at: [conveyor.x0 + 2.2, 0.74, conveyor.z + 0.05] }));
  add("#7a5a3e", cylinder(0.045, 0.034, 0.1, 10, { at: [conveyor.x0 + 3.4, 0.73, conveyor.z - 0.12] }));
  add("#e8c23c", ico(0.05, 0, { at: [conveyor.x0 + 4.6, 0.71, conveyor.z + 0.02], scale: [1.6, 0.5, 0.7] }));
  for (const bin of bins) {
    const colour = { paper: PLAY.paperBin, recycling: PLAY.recyclingBin, general: PLAY.generalBin }[bin.id];
    const [bx, , bz] = bin.position;
    add(colour, box(0.78, 0.95, 0.9, { at: [bx, 0.475, bz] }));
    add("#1c2421", box(0.62, 0.02, 0.74, { at: [bx, 0.955, bz] }));
    add(PLAY.chrome, box(0.78, 0.04, 0.04, { at: [bx, 0.95, bz - 0.44] }));
    shine("#f2f2ee", box(0.36, 0.1, 0.012, { at: [bx, 0.6, bz - 0.456] }));
  }

  // Beanbags, squashed spheres in three colours.
  layout.beanbags.forEach((bag) => {
    const [bx, , bz] = bag.position;
    add(PLAY.beanbags[bag.color % PLAY.beanbags.length], sphere(0.5, 14, 10, { at: [bx, 0.3, bz], scale: [1, 0.62, 1] }));
    add(PLAY.beanbags[bag.color % PLAY.beanbags.length], sphere(0.34, 10, 8, { at: [bx - Math.sin(bag.yaw) * -0.22, 0.52, bz - Math.cos(bag.yaw) * -0.22], scale: [1, 0.7, 1] }));
  });

  // The leaderboard wall's frame.
  const { center, width: panelWidth, height: panelHeight } = layout.wall;
  add(OFFICE.dark, box(panelWidth + 0.24, panelHeight + 0.24, 0.04, { at: [center[0], center[1], z0 + 0.12] }));
  shine("#9fd8c3", box(panelWidth + 0.24, 0.03, 0.02, { at: [center[0], center[1] + panelHeight / 2 + 0.135, z0 + 0.14] }));

  return { matte, glow };
}
