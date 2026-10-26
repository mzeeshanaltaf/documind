import { describe, expect, it } from "vitest";
import { buildFloorplan } from "@/game/world/office/floorplan";
import { blocked, DECK, rooftopLayout } from "@/game/world/office/rooftop-layout";
import { landmarkInfo } from "@/content/landmarks";
import { LANDMARK_KITS } from "@/lib/locations";

// Phase O9 › Rooftop: the lounge plan is playable (nothing solid on the spawn or in front of what
// you use), and every landmark has a name and a fact for the telescope.

const layout = rooftopLayout();

describe("rooftop layout", () => {
  it("keeps every piece of furniture on the deck", () => {
    const { x, z, w, d } = DECK;
    for (const { center, half } of layout.colliders.slice(5)) {
      expect(Math.abs(center[0] - x) + half[0], JSON.stringify(center)).toBeLessThanOrEqual(w / 2 + 1e-6);
      expect(Math.abs(center[2] - z) + half[2], JSON.stringify(center)).toBeLessThanOrEqual(d / 2 + 1e-6);
    }
  });

  it("spawns in the open, facing north, and leaves room in front of everything you use", () => {
    expect(layout.spawn.yaw).toBeCloseTo(Math.PI);
    expect(blocked(layout, layout.spawn.position[0], layout.spawn.position[2], 0.4)).toBe(false);
    for (const [name, spot] of Object.entries({ call: layout.lift.call, plaque: layout.plaque.use })) {
      expect(blocked(layout, spot[0], spot[2], 0.4), name).toBe(false);
    }
    // The telescope, the fireworks panel and the sofas are used from beside them.
    expect(blocked(layout, layout.telescope[0] - 1.2, layout.telescope[2], 0.4)).toBe(false);
    expect(blocked(layout, layout.panel[0] - 1.1, layout.panel[2], 0.4)).toBe(false);
  });

  it("closes the deck in on all four sides, taller than a jump", () => {
    const walls = layout.colliders.slice(1, 5);
    for (const wall of walls) expect(wall.center[1] + wall.half[1]).toBeGreaterThanOrEqual(2.4);
    const { w, d } = DECK;
    expect(walls.some((wall) => wall.center[2] < -d / 2)).toBe(true);
    expect(walls.some((wall) => wall.center[2] > d / 2)).toBe(true);
    expect(walls.some((wall) => wall.center[0] < -w / 2)).toBe(true);
    expect(walls.some((wall) => wall.center[0] > w / 2)).toBe(true);
  });

  it("hangs its string lights between the posts", () => {
    for (const { from, to } of layout.strings) {
      expect(from[1]).toBe(to[1]);
      expect(Math.hypot(to[0] - from[0], to[2] - from[2])).toBeGreaterThan(5);
    }
  });

  it("arrives from the corridor lift: the office plan has a lift spawn to return to", () => {
    const plan = buildFloorplan(["HR", "IT"]);
    expect(plan.doors.find((door) => door.kind === "lift")?.requires).toBe("unlock:rooftop");
    expect(plan.spawns.lift.position[2]).toBeLessThan(plan.rooms.find((room) => room.id === "lobby")!.rect.z);
  });
});

describe("landmark facts", () => {
  it("gives every kit a name and a fact", () => {
    for (const kit of LANDMARK_KITS) {
      const info = landmarkInfo("nobody", { id: "somewhere", name: "Somewhere", landmarkKit: kit });
      expect(info.name, kit).not.toBe("");
      expect(info.fact.length, kit).toBeGreaterThan(30);
    }
  });

  it("uses Simtora's own text for its offices", () => {
    const info = landmarkInfo("simtora", { id: "lahore", name: "Lahore", landmarkKit: "minar" });
    expect(info.name).toBe("Minar-e-Pakistan");
    expect(info.fact).toContain("Lahore");
  });
});
