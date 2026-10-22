import { describe, expect, it } from "vitest";
import { SIMTORA_LOCATIONS } from "@/content/orgs/simtora";
import {
  CITY,
  type CityLayout,
  generateCity,
  insideBox,
  reachable,
  rectInside,
  rectsOverlap,
  windowsOf,
} from "@/game/world/city/generator";
import { hubLayout } from "@/game/world/city/hub-layout";
import { atLocalHour, directionFrom, GOLDEN_HOUR, localHour, skyAt, skyState } from "@/game/world/city/lighting";
import { makeLoop, roundedSquareLoop, sampleLoop } from "@/game/world/city/paths";
import { hashString, mulberry32 } from "@/game/world/city/random";
import { planFleet } from "@/game/world/city/vehicles";
import { cityEntrySpawn, cityExitSpawn } from "@/game/world/city/spawns";
import { deriveLocations } from "@/lib/locations";
import { arrivalLines, shortOrgName } from "@/lib/format";

// Phase O4 › Tests: the city generator, traffic loops and the sun phase.

const DOCS = [
  { jurisdiction: "US", doc_code: "SIM-HR-001", indexed_at: "2026-10-07" },
  { jurisdiction: "PK", doc_code: "SIM-HR-101", indexed_at: "2026-10-07" },
  { jurisdiction: "DE", doc_code: "SIM-HR-102", indexed_at: "2026-10-07" },
  { jurisdiction: "FR", doc_code: "SIM-HR-103", indexed_at: "2026-10-07" },
  { jurisdiction: "AU", doc_code: "SIM-HR-104", indexed_at: "2026-10-07" },
  { jurisdiction: "GB", doc_code: "SIM-HR-105", indexed_at: "2026-10-07" },
  { jurisdiction: "PL", doc_code: "ACME-HR-9", indexed_at: "2026-10-07" },
];
const PLACES = deriveLocations({ slug: "simtora" }, DOCS).filter((place) => place.role !== "hub");
const byId = (id: string) => PLACES.find((place) => place.id === id)!;

describe("seeded randomness", () => {
  it("is deterministic per seed and spread over [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("hashes ids to stable, distinct seeds", () => {
    expect(hashString("lahore")).toBe(hashString("lahore"));
    expect(new Set(SIMTORA_LOCATIONS.map((l) => hashString(l.id))).size).toBe(SIMTORA_LOCATIONS.length);
  });
});

describe("generateCity", () => {
  it("builds the same city for the same location and seed", () => {
    const lahore = byId("lahore");
    expect(generateCity(lahore)).toEqual(generateCity(lahore));
    expect(generateCity(lahore, 7)).toEqual(generateCity(lahore, 7));
    expect(generateCity(lahore, 7).buildings).not.toEqual(generateCity(lahore, 8).buildings);
  });

  it("gives every city its own layout and its palette's storeys", () => {
    const layouts = PLACES.map((place) => generateCity(place));
    const signatures = new Set(layouts.map((layout) => JSON.stringify(layout.buildings.map((b) => b.rect))));
    expect(signatures.size).toBe(layouts.length);
    for (const [index, layout] of layouts.entries()) {
      const [min, max] = PLACES[index].palette.floors;
      for (const building of layout.buildings) {
        expect(building.floors).toBeGreaterThanOrEqual(min);
        expect(building.floors).toBeLessThanOrEqual(max);
        expect(PLACES[index].palette.buildings).toContain(building.color);
      }
    }
  });

  it.each(PLACES.map((place) => [place.id, place] as const))(
    "%s: no building overlaps a street, the plaza or the office",
    (_, place) => {
      const layout = generateCity(place);
      expect(layout.buildings.length).toBeGreaterThan(10);
      for (const building of layout.buildings) {
        for (const road of layout.roads) expect(rectsOverlap(building.rect, road)).toBe(false);
        expect(rectsOverlap(building.rect, layout.plaza)).toBe(false);
        expect(rectsOverlap(building.rect, layout.office.rect)).toBe(false);
        // Inside an ordinary block, behind its pavement.
        const block = layout.blocks.find((b) => rectInside(building.rect, b.rect));
        expect(block?.kind).toBe("buildings");
        const area = { ...block!.rect, w: block!.rect.w - CITY.pavement * 2, d: block!.rect.d - CITY.pavement * 2 };
        expect(rectInside(building.rect, area)).toBe(true);
      }
      for (const [i, a] of layout.buildings.entries()) {
        for (const b of layout.buildings.slice(i + 1)) expect(rectsOverlap(a.rect, b.rect)).toBe(false);
      }
      // Skyline towers stay out past the boundary, and out of the landmark's vista.
      for (const tower of layout.skyline) {
        for (const road of layout.roads) expect(rectsOverlap(tower.rect, road)).toBe(false);
        for (const sector of layout.vista) expect(rectsOverlap(tower.rect, sector)).toBe(false);
        const reach = Math.max(Math.abs(tower.rect.x) - tower.rect.w / 2, Math.abs(tower.rect.z) - tower.rect.d / 2);
        expect(reach).toBeGreaterThan(CITY.half);
      }
      // The office stands inside the central block, which is the only office block.
      const office = layout.blocks.filter((b) => b.kind === "office");
      expect(office).toHaveLength(1);
      expect(rectInside(layout.office.rect, office[0].rect)).toBe(true);
      expect(layout.blocks.filter((b) => b.kind === "vista")).toHaveLength(1);
    },
  );

  it("has one collider per building, plus the office, plaza edges and boundary", () => {
    for (const place of PLACES) {
      const layout = generateCity(place);
      const count = (kind: string) => layout.colliders.filter((c) => c.kind === kind).length;
      expect(count("building")).toBe(layout.buildings.length);
      expect(count("block")).toBe(9);
      expect(count("office")).toBe(3);
      expect(count("plaza-edge")).toBe(layout.ledges.length);
      expect(count("boundary")).toBe(4);
      expect(count("furniture")).toBe(layout.furniture.length);
      for (const building of layout.buildings) {
        const match = layout.colliders.find(
          (c) => c.kind === "building" && c.center[0] === building.rect.x && c.center[2] === building.rect.z,
        );
        expect(match?.half).toEqual([building.rect.w / 2, building.height / 2, building.rect.d / 2]);
      }
    }
  });

  it("reaches the entrance from the spawn on the walk graph, and every node is connected", () => {
    for (const place of PLACES) {
      const { walk } = generateCity(place);
      const spawn = walk.nodes.find((n) => n.kind === "spawn")!;
      const entrance = walk.nodes.find((n) => n.kind === "entrance")!;
      expect(reachable(walk, spawn.id, entrance.id)).toBe(true);
      for (const node of walk.nodes) expect(reachable(walk, spawn.id, node.id)).toBe(true);
      // Pavement paths never run through a building.
      const layout = generateCity(place);
      for (const node of walk.nodes) {
        for (const building of layout.buildings) {
          expect(rectsOverlap({ x: node.x, z: node.z, w: 0.6, d: 0.6 }, building.rect)).toBe(false);
        }
      }
    }
  });

  it("spawns on the plaza facing the doors, with the entrance straight ahead", () => {
    const layout = generateCity(byId("berlin"));
    const [x, y, z] = layout.spawn.position;
    expect(y).toBe(CITY.curb);
    expect(rectInside({ x, z, w: 0.6, d: 0.6 }, layout.plaza)).toBe(true);
    // Heading π faces −z: walking straight on from the spawn meets the entrance box.
    expect(layout.spawn.yaw).toBeCloseTo(Math.PI);
    const ahead = { x, y: 0.2, z: layout.entrance.center[2] };
    expect(insideBox(ahead, layout.entrance)).toBe(true);
    expect(insideBox({ x, y: 0.2, z }, layout.entrance)).toBe(false);
    // Coming back out lands outside the box, facing away from the building.
    const exit = layout.exit.position;
    expect(insideBox({ x: exit[0], y: exit[1] + 0.1, z: exit[2] }, layout.entrance)).toBe(false);
    expect(layout.exit.yaw).toBe(0);
    expect(exit[2]).toBeGreaterThan(layout.office.door.z);
    // The doors' recess is open: no office collider covers the entrance box.
    for (const collider of layout.colliders.filter((c) => c.kind === "office")) {
      const overlapX = Math.abs(collider.center[0] - layout.entrance.center[0]) < collider.half[0] + layout.entrance.half[0];
      const overlapZ = Math.abs(collider.center[2] - layout.entrance.center[2]) < collider.half[2] + layout.entrance.half[2];
      expect(overlapX && overlapZ).toBe(false);
    }
  });

  it("drives on the left in London, Sydney and Lahore", () => {
    expect(generateCity(byId("london")).driveOnLeft).toBe(true);
    expect(generateCity(byId("sydney")).driveOnLeft).toBe(true);
    expect(generateCity(byId("lahore")).driveOnLeft).toBe(true);
    expect(generateCity(byId("berlin")).driveOnLeft).toBe(false);
    // Clockwise traffic keeps to the inside lane on the right, the outside lane on the left.
    const inner = (layout: CityLayout) => sampleLoop(layout.loops.find((l) => l.id === "inner-cw")!, 0);
    expect(Math.abs(inner(generateCity(byId("berlin"))).z)).toBeLessThan(CITY.pitch / 2);
    expect(Math.abs(inner(generateCity(byId("london"))).z)).toBeGreaterThan(CITY.pitch / 2);
  });

  it("lights some windows and gives the generic kit a city too", () => {
    const layout = generateCity(byId("warsaw"));
    expect(layout.kit).toBe("generic");
    const windows = layout.buildings.flatMap((building) => windowsOf(building, layout.seed));
    expect(windows.length).toBeGreaterThan(200);
    const lit = windows.filter((w) => w.lit > 0).length / windows.length;
    expect(lit).toBeGreaterThan(0.3);
    expect(lit).toBeLessThan(0.55);
    expect(windowsOf(layout.buildings[0], layout.seed)).toEqual(windowsOf(layout.buildings[0], layout.seed));
  });
});

describe("traffic loops", () => {
  it("samples a closed loop by distance, wrapping round", () => {
    const square = makeLoop("square", [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ]);
    expect(square.length).toBe(40);
    expect(sampleLoop(square, 5)).toMatchObject({ x: 5, z: 0 });
    expect(sampleLoop(square, 5).heading).toBeCloseTo(Math.PI / 2);
    expect(sampleLoop(square, 25)).toMatchObject({ x: 5, z: 10 });
    expect(sampleLoop(square, 45)).toMatchObject({ x: 5, z: 0 });
    expect(sampleLoop(square, -5)).toMatchObject({ x: 0, z: 5 });
  });

  it("rounds the corners of a block loop and runs the chosen way round", () => {
    const loop = roundedSquareLoop("test", { half: 20, radius: 5, clockwise: true });
    // Four straights of 30 m and four quarter circles of radius 5 (polyline, so a hair shorter).
    expect(loop.length).toBeGreaterThan(4 * 30 + 2 * Math.PI * 5 - 0.5);
    expect(loop.length).toBeLessThan(4 * 30 + 2 * Math.PI * 5);
    // Clockwise from above: east along the north side (the straight that closes the loop).
    const north = sampleLoop(loop, loop.length - 15);
    expect(north.x).toBeCloseTo(0);
    expect(north.z).toBeCloseTo(-20);
    expect(Math.sin(north.heading)).toBeCloseTo(1);
    const reverse = roundedSquareLoop("test", { half: 20, radius: 5, clockwise: false });
    const back = sampleLoop(reverse, reverse.length - 15);
    expect(back.z).toBeCloseTo(-20);
    expect(Math.sin(back.heading)).toBeCloseTo(-1);
  });
});

describe("traffic fleet", () => {
  it("spreads a fixed, city-specific fleet over the loops", () => {
    const london = generateCity(byId("london"));
    const cars = planFleet(london.loops, london.kit, 20, london.seed);
    expect(cars).toHaveLength(20);
    expect(planFleet(london.loops, london.kit, 20, london.seed)).toEqual(cars);
    // Every loop gets cars, the long ring road the most.
    const perLoop = london.loops.map((_, index) => cars.filter((car) => car.loop === index).length);
    expect(Math.min(...perLoop)).toBeGreaterThan(0);
    expect(perLoop[2] + perLoop[3]).toBeGreaterThan(perLoop[0] + perLoop[1]);
    // Red buses and black cabs in London, rickshaws in Lahore, nothing on the floating hub.
    const kinds = new Set(cars.map((car) => car.kind));
    expect(kinds.has("bus") && kinds.has("cab")).toBe(true);
    const lahore = generateCity(byId("lahore"));
    expect(planFleet(lahore.loops, lahore.kit, 14, lahore.seed).some((car) => car.kind === "rickshaw")).toBe(true);
    expect(planFleet(london.loops, "global-hub", 14, 1)).toEqual([]);
    // Each kind's cars number their instance slots from 0.
    for (const kind of kinds) {
      const slots = cars.filter((car) => car.kind === kind).map((car) => car.slot);
      expect(slots).toEqual([...slots.keys()]);
    }
  });
});

describe("Global Hub", () => {
  it("lays out one kiosk per office round the plaza, clear of the building", () => {
    const hub = hubLayout(6);
    expect(hub.kiosks).toHaveLength(6);
    for (const kiosk of hub.kiosks) {
      expect(Math.hypot(kiosk.x, kiosk.z)).toBeLessThan(hub.radius - 3);
      expect(rectsOverlap({ x: kiosk.x, z: kiosk.z, w: 2, d: 2 }, hub.office.rect)).toBe(false);
    }
    expect(insideBox({ x: hub.spawn.position[0], y: 0.2, z: hub.entrance.center[2] }, hub.entrance)).toBe(true);
    const spawn = hub.walk.nodes.find((n) => n.kind === "spawn")!;
    for (const node of hub.walk.nodes) expect(reachable(hub.walk, spawn.id, node.id)).toBe(true);
  });

  it("starts the hub and each city at its own spawn", () => {
    const hub = deriveLocations({ slug: "simtora" }, DOCS).find((place) => place.role === "hub")!;
    expect(cityEntrySpawn(hub)).toEqual(hubLayout(0).spawn);
    expect(cityExitSpawn(hub)).toEqual(hubLayout(0).exit);
    expect(cityEntrySpawn(byId("paris"))).toEqual(generateCity(byId("paris")).spawn);
  });
});

describe("sun phase", () => {
  it("is day at Lahore noon and night at 02:00 in Sydney", () => {
    // 2026-10-22: Lahore is UTC+5, Sydney is on daylight time (UTC+11).
    const lahoreNoon = Date.UTC(2026, 9, 22, 7, 0);
    const sydneyTwoAm = Date.UTC(2026, 9, 21, 15, 0);
    const lahore = byId("lahore");
    const sydney = byId("sydney");
    expect(localHour(lahoreNoon, lahore.timezone)).toBe(12);
    expect(localHour(sydneyTwoAm, sydney.timezone)).toBe(2);

    const day = skyAt(lahoreNoon, lahore.lat!, lahore.lon!);
    expect(day.phase).toBe("day");
    expect(day.isNight).toBe(false);
    expect(day.night).toBe(0);
    expect(day.altitude).toBeGreaterThan(40);
    // Lahore is north of the tropic in October: the noon sun stands in the south (+z).
    expect(day.sun[2]).toBeGreaterThan(0);

    const night = skyAt(sydneyTwoAm, sydney.lat!, sydney.lon!);
    expect(night.phase).toBe("night");
    expect(night.isNight).toBe(true);
    expect(night.night).toBe(1);
    // Moonlight comes from above the horizon.
    expect(night.keyDirection[1]).toBeGreaterThan(0.3);
    expect(night.keyIntensity).toBeLessThan(day.keyIntensity / 3);
  });

  it("moves the debug clock to a local hour, and dusk sits between day and night", () => {
    const now = Date.UTC(2026, 9, 22, 9, 30);
    const berlin = byId("berlin");
    expect(localHour(atLocalHour(now, berlin.timezone, 22.25), berlin.timezone)).toBeCloseTo(22.25, 5);
    expect(localHour(atLocalHour(now, "Asia/Kolkata", 6), "Asia/Kolkata")).toBeCloseTo(6, 5);

    const dusk = skyState(-3, 260);
    expect(dusk.phase).toBe("twilight");
    expect(dusk.night).toBeGreaterThan(0);
    expect(dusk.night).toBeLessThan(1);
    expect(GOLDEN_HOUR.phase).toBe("golden");
    expect(GOLDEN_HOUR.isNight).toBe(false);
  });

  it("points compass directions at the right axes", () => {
    const [ex, , ez] = directionFrom(90, 0);
    expect(ex).toBeCloseTo(1);
    expect(ez).toBeCloseTo(0);
    expect(directionFrom(0, 0)[2]).toBeCloseTo(-1);
    expect(directionFrom(0, 90)[1]).toBeCloseTo(1);
  });
});

describe("arrival banner", () => {
  it("shortens org names", () => {
    expect(shortOrgName("Simtora Technologies")).toBe("Simtora");
    expect(shortOrgName("Simtora Technologies, Inc.")).toBe("Simtora");
    expect(shortOrgName("Acme")).toBe("Acme");
    expect(shortOrgName("Northwind Group Holdings")).toBe("Northwind");
  });

  it("says where you are, the local time and which office", () => {
    const at = Date.UTC(2026, 9, 22, 14, 42);
    expect(arrivalLines(byId("lahore"), "Simtora Technologies", at)).toEqual({
      title: "Lahore",
      details: ["7:42 pm local time", "Simtora R&D centre"],
    });
    expect(arrivalLines(byId("san-francisco"), "Simtora Technologies", at).details[1]).toBe("Simtora headquarters");
    const hub = deriveLocations({ slug: "simtora" }, DOCS).at(-1)!;
    expect(arrivalLines(hub, "Simtora Technologies", at)).toEqual({
      title: "Global Hub",
      details: ["Kiosks lead to every Simtora office"],
    });
  });
});
