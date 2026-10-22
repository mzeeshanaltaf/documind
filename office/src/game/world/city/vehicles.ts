import type { BufferGeometry } from "three";
import type { LandmarkKit } from "@/lib/locations";
import { box, mergeVertexColored, type Part } from "./merge";
import type { Loop } from "./paths";
import { hashString, mulberry32, pick, type Random } from "./random";

/**
 * Low-poly vehicles, each one vertex-coloured geometry facing +z: white parts take the
 * instance colour (the paint), dark parts stay dark (glass, tyres, canopies).
 */
export type VehicleKind = "sedan" | "hatch" | "taxi" | "rickshaw" | "bus" | "coach" | "cab";

const PAINT = "#ffffff";
const GLASS = "#2a3236";
const TYRE = "#1b1e20";
const LIGHT = "#f4efd8";
const REAR = "#b23a2e";

export const VEHICLE_LENGTH: Record<VehicleKind, number> = {
  sedan: 4.4,
  hatch: 3.8,
  taxi: 4.4,
  rickshaw: 2.7,
  bus: 10,
  coach: 11,
  cab: 4.6,
};

/** Cruising speed in m/s (about 30 km/h for cars). */
export const VEHICLE_SPEED: Record<VehicleKind, number> = {
  sedan: 8.5,
  hatch: 8,
  taxi: 8.5,
  rickshaw: 6.5,
  bus: 6.5,
  coach: 7,
  cab: 8,
};

function wheels(halfWidth: number, axles: number[], radius = 0.32): Part[] {
  return axles.flatMap((z) =>
    [-halfWidth, halfWidth].map((x) => ({ color: TYRE, geometry: box(0.28, radius * 2, radius * 2, { at: [x, radius, z] }) })),
  );
}

function car(length: number, cabin: number, height = 0.62, roofSign = false, tall = false): Part[] {
  const half = length / 2;
  const parts: Part[] = [
    { color: PAINT, geometry: box(1.8, height, length, { at: [0, 0.3 + height / 2, 0] }) },
    { color: GLASS, geometry: box(1.6, tall ? 0.72 : 0.5, cabin, { at: [0, 0.3 + height + (tall ? 0.36 : 0.25), -0.15] }) },
    { color: PAINT, geometry: box(1.62, 0.08, cabin - 0.2, { at: [0, 0.3 + height + (tall ? 0.76 : 0.54), -0.15] }) },
    { color: LIGHT, geometry: box(1.5, 0.14, 0.05, { at: [0, 0.3 + height * 0.7, half + 0.02] }) },
    { color: REAR, geometry: box(1.5, 0.14, 0.05, { at: [0, 0.3 + height * 0.7, -half - 0.02] }) },
    ...wheels(0.82, [half - 0.85, -half + 0.85]),
  ];
  if (roofSign) parts.push({ color: PAINT, geometry: box(0.55, 0.2, 0.28, { at: [0, 0.3 + height + 0.68, -0.1] }) });
  return parts;
}

function rickshaw(): Part[] {
  return [
    { color: PAINT, geometry: box(1.3, 0.7, 2.5, { at: [0, 0.65, -0.1] }) },
    { color: PAINT, geometry: box(0.9, 0.7, 0.4, { at: [0, 0.95, 1.2] }) },
    { color: GLASS, geometry: box(1.0, 0.55, 0.06, { at: [0, 1.55, 1.15] }) },
    { color: TYRE, geometry: box(1.42, 0.1, 2.3, { at: [0, 1.9, -0.1] }) },
    { color: TYRE, geometry: box(1.4, 0.7, 0.06, { at: [0, 1.5, -1.3] }) },
    ...[
      [-0.62, 1.1],
      [0.62, 1.1],
      [-0.62, -1.1],
      [0.62, -1.1],
    ].map(([x, z]) => ({ color: TYRE, geometry: box(0.06, 0.9, 0.06, { at: [x, 1.45, z] }) })),
    { color: TYRE, geometry: box(0.2, 0.5, 0.5, { at: [0, 0.25, 1.0] }) },
    ...wheels(0.6, [-0.9], 0.25),
  ];
}

function bus(decks: 1 | 2, length: number): Part[] {
  const half = length / 2;
  const height = decks === 2 ? 4.1 : 2.9;
  const parts: Part[] = [
    { color: PAINT, geometry: box(2.5, height, length, { at: [0, 0.35 + height / 2, 0] }) },
    { color: GLASS, geometry: box(2.54, 0.85, length - 1.4, { at: [0, 1.9, -0.3] }) },
    { color: GLASS, geometry: box(2.3, 1.0, 0.06, { at: [0, 1.9, half + 0.02] }) },
    ...wheels(1.15, [half - 1.8, -half + 2.2], 0.45),
  ];
  if (decks === 2) parts.push({ color: GLASS, geometry: box(2.54, 0.8, length - 0.8, { at: [0, 3.45, 0] }) });
  return parts;
}

export function vehicleGeometry(kind: VehicleKind): BufferGeometry {
  switch (kind) {
    case "sedan":
      return mergeVertexColored(car(4.4, 2.3));
    case "hatch":
      return mergeVertexColored(car(3.8, 2.2, 0.66));
    case "taxi":
      return mergeVertexColored(car(4.4, 2.3, 0.62, true));
    case "cab":
      return mergeVertexColored(car(4.6, 2.6, 0.7, true, true));
    case "rickshaw":
      return mergeVertexColored(rickshaw());
    case "bus":
      return mergeVertexColored(bus(2, 10));
    case "coach":
      return mergeVertexColored(bus(1, 11));
  }
}

const PAINTS = ["#e8e8e2", "#b8bcbc", "#4c5a63", "#8c2f2a", "#2f4f6b", "#d9d2c0", "#3c4a42", "#20262a"];

export type FleetEntry = { kind: VehicleKind; weight: number; colors: string[] };

/** Each city's traffic mix. */
export const FLEETS: Record<LandmarkKit, FleetEntry[]> = {
  "golden-gate": [
    { kind: "sedan", weight: 5, colors: PAINTS },
    { kind: "taxi", weight: 2, colors: ["#e8b931"] },
    { kind: "hatch", weight: 2, colors: PAINTS },
  ],
  minar: [
    { kind: "rickshaw", weight: 5, colors: ["#2f7d4f", "#2f6f9a", "#c9a227", "#2f7d4f"] },
    { kind: "sedan", weight: 3, colors: ["#e8e8e2", "#b8bcbc", "#a33a32"] },
    { kind: "hatch", weight: 1, colors: PAINTS },
  ],
  brandenburg: [
    { kind: "sedan", weight: 4, colors: PAINTS },
    { kind: "hatch", weight: 3, colors: PAINTS },
    { kind: "coach", weight: 1, colors: ["#e9c74a"] },
    { kind: "taxi", weight: 1, colors: ["#e9dfc4"] },
  ],
  eiffel: [
    { kind: "hatch", weight: 6, colors: PAINTS },
    { kind: "sedan", weight: 3, colors: PAINTS },
  ],
  "opera-house": [
    { kind: "sedan", weight: 5, colors: PAINTS },
    { kind: "hatch", weight: 3, colors: PAINTS },
    { kind: "coach", weight: 1, colors: ["#e8e6df"] },
  ],
  "elizabeth-tower": [
    { kind: "bus", weight: 3, colors: ["#c1272d"] },
    { kind: "cab", weight: 4, colors: ["#1f2224", "#1f2224", "#2b2f31"] },
    { kind: "sedan", weight: 2, colors: PAINTS },
  ],
  generic: [
    { kind: "sedan", weight: 5, colors: PAINTS },
    { kind: "hatch", weight: 4, colors: PAINTS },
  ],
  "global-hub": [],
};

export type Car = {
  kind: VehicleKind;
  color: string;
  loop: number;
  /** Distance along the loop. */
  s: number;
  speed: number;
  cruise: number;
  length: number;
  /** Index within its kind's instanced mesh. */
  slot: number;
};

function weighted(random: Random, kit: LandmarkKit) {
  const fleet = FLEETS[kit];
  const total = fleet.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of fleet) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return fleet[fleet.length - 1];
}

/** Deterministic cars for a city: `count` spread over the loops in proportion to their length. */
export function planFleet(loops: Loop[], kit: LandmarkKit, count: number, seed: number): Car[] {
  if (FLEETS[kit].length === 0 || count === 0) return [];
  const random = mulberry32(seed ^ hashString("traffic"));
  const total = loops.reduce((sum, loop) => sum + loop.length, 0);
  const cars: Car[] = [];
  const slots = new Map<VehicleKind, number>();
  let left = count;
  loops.forEach((loop, index) => {
    const share = index === loops.length - 1 ? left : Math.max(1, Math.round((count * loop.length) / total));
    const n = Math.min(left, share);
    left -= n;
    for (let k = 0; k < n; k++) {
      const entry = weighted(random, kit);
      const slot = slots.get(entry.kind) ?? 0;
      slots.set(entry.kind, slot + 1);
      const cruise = VEHICLE_SPEED[entry.kind] * (0.9 + random() * 0.2);
      cars.push({
        kind: entry.kind,
        color: pick(random, entry.colors),
        loop: index,
        s: ((k + random() * 0.4) / n) * loop.length,
        speed: cruise,
        cruise,
        length: VEHICLE_LENGTH[entry.kind],
        slot,
      });
    }
  });
  return cars;
}
