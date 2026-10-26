import { describe, expect, it } from "vitest";
import { QUEST_IDS } from "@/game/quests/definitions";
import { emptyProgress } from "@/game/quests/engine";
import { guidePath, guideTarget, pathLength, pointAlong } from "@/game/quests/guide";
import { buildFloorplan, roomAt } from "@/game/world/office/floorplan";

// Phase O9 › "Show me": where each quest points, and a route that goes through doors.

const plan = buildFloorplan(["HR", "IT", "Finance", "Facilities"]);

describe("guideTarget", () => {
  it("points every quest somewhere inside the plan", () => {
    for (const id of QUEST_IDS) {
      const target = guideTarget(id, plan, emptyProgress());
      expect(target, id).not.toBeNull();
      const [x, , z] = target!.position;
      const { x0, x1, z0, z1 } = { x0: plan.bounds.x - plan.bounds.w / 2, x1: plan.bounds.x + plan.bounds.w / 2, z0: plan.bounds.z - plan.bounds.d / 2, z1: plan.bounds.z + plan.bounds.d / 2 };
      // The street doors' approach lies just outside the lobby's south wall.
      expect(x >= x0 && x <= x1 && z >= z0 && z <= z1 + 2, id).toBe(true);
    }
  });

  it("sends the expert quests to a department that is still to do, then wraps round", () => {
    const first = guideTarget("meet_experts", plan, emptyProgress())!;
    expect(first.label).toBe("HR expert");
    const progress = { ...emptyProgress(), stats: { asked_departments: ["HR", "IT"] } };
    expect(guideTarget("meet_experts", plan, progress)!.label).toBe("Finance expert");
    const all = { ...emptyProgress(), stats: { asked_departments: ["HR", "IT", "Finance", "Facilities"] } };
    expect(guideTarget("meet_experts", plan, all)!.label).toBe("HR expert");
  });

  it("sends the tour to the next unvisited room", () => {
    const progress = { ...emptyProgress(), stats: { departments_entered: ["HR"] } };
    expect(guideTarget("department_tour", plan, progress)!.label).toBe("IT room");
  });

  it("has nothing to point at without departments", () => {
    const bare = buildFloorplan([]);
    expect(guideTarget("meet_experts", bare, emptyProgress())).toBeNull();
    expect(guideTarget("first_day", bare, emptyProgress())).not.toBeNull();
  });
});

describe("guidePath", () => {
  it("is a straight line inside one room", () => {
    const path = guidePath(plan, [-3, 3], [3, 3]);
    expect(path).toHaveLength(2);
  });

  it("goes through the doors between rooms and ends at the target", () => {
    const target = guideTarget("meet_experts", plan, emptyProgress())!;
    const path = guidePath(plan, [0, 3], [target.position[0], target.position[2]]);
    // lobby → security door → corridor → HR's door → HR room
    expect(path).toHaveLength(4);
    expect(path[1][2]).toBeCloseTo(plan.doors.find((d) => d.id === "security")!.z);
    expect(path[2][0]).toBeCloseTo(plan.doors.find((d) => d.id === "dept:HR")!.x);
    expect(path.at(-1)![0]).toBeCloseTo(target.position[0]);
    expect(roomAt(plan, path[2][0] + 0.01, path[2][2])).not.toBeNull();
  });

  it("measures and walks along the route", () => {
    const path = guidePath(plan, [0, 3], [-3, 3]);
    expect(pathLength(path)).toBeCloseTo(3);
    expect(pointAlong(path, 1.5)[0]).toBeCloseTo(-1.5);
    expect(pointAlong(path, 99)[0]).toBeCloseTo(-3);
    expect(pointAlong(path, -5)[0]).toBeCloseTo(0);
  });

  it("falls back to a straight line outside the plan", () => {
    expect(guidePath(plan, [500, 500], [0, 3])).toHaveLength(2);
  });
});
