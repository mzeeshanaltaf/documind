import { type Floorplan, roomAt, type Vec3 } from "@/game/world/office/floorplan";
import type { Progress, QuestId } from "./definitions";

/**
 * The journal's "Show me" (phase O9): where a quest's next step is on the floor plan, and the
 * walkable route there (through the doors, so the trail never cuts through a wall). Pure.
 */
export type GuideTarget = { label: string; position: Vec3 };

const FLOOR = 0.05;
const floor = ([x, , z]: Vec3): Vec3 => [x, FLOOR, z];

/** The first department that `done` hasn't got yet, else the first one. */
function nextDepartment(plan: Floorplan, done: string[] | undefined): string | null {
  const rooms = plan.rooms.flatMap((room) => (room.department ? [room.department] : []));
  return rooms.find((department) => !done?.includes(department)) ?? rooms[0] ?? null;
}

/** Where the quest's next step is, or null when this office has nothing to point at. */
export function guideTarget(quest: QuestId, plan: Floorplan, progress: Progress): GuideTarget | null {
  const roomCentre = (id: string, label: string): GuideTarget | null => {
    const room = plan.rooms.find((r) => r.id === id);
    return room ? { label, position: [room.rect.x, 0, room.rect.z] } : null;
  };
  const expert = (department: string | null): GuideTarget | null => {
    const spot = department ? plan.npcSpots[`expert:${department}`] : undefined;
    return department && spot ? { label: `${department} expert`, position: spot.position } : null;
  };
  switch (quest) {
    case "first_day":
      return { label: "Reception", position: plan.npcSpots.reception.position };
    case "orientation":
      return roomCentre("presentation", "Presentation room");
    case "meet_experts":
    case "check_source":
    case "bookworm":
      return expert(nextDepartment(plan, progress.stats.asked_departments));
    case "department_tour": {
      const department = nextDepartment(plan, progress.stats.departments_entered);
      return department ? roomCentre(`dept:${department}`, `${department} room`) : null;
    }
    case "team_spirit":
    case "trivia_ace":
    case "clean_desk":
    case "rally":
      return roomCentre("play", "Play area");
    case "globetrotter":
    case "local_knowledge":
      return { label: "Street doors", position: [plan.exit.center[0], 0, plan.exit.center[2] - 1.5] };
  }
}

/**
 * Points from `from` to `to` on the floor, through the doors between rooms (a breadth-first
 * search over the room graph). Falls back to a straight line when either end is outside the plan.
 */
export function guidePath(plan: Floorplan, from: readonly [number, number], to: readonly [number, number]): Vec3[] {
  const start: Vec3 = [from[0], FLOOR, from[1]];
  const end: Vec3 = [to[0], FLOOR, to[1]];
  const here = roomAt(plan, from[0], from[1]);
  const there = roomAt(plan, to[0], to[1]);
  if (!here || !there || here.id === there.id) return [start, end];

  const previous = new Map<string, { room: string; door: Floorplan["doors"][number] }>();
  const queue = [here.id];
  const seen = new Set(queue);
  while (queue.length > 0 && !seen.has(there.id)) {
    const room = queue.shift()!;
    for (const door of plan.doors) {
      const next = door.from === room ? door.to : door.to === room ? door.from : null;
      if (!next || seen.has(next) || !plan.rooms.some((r) => r.id === next)) continue;
      seen.add(next);
      previous.set(next, { room, door });
      queue.push(next);
    }
  }
  if (!previous.has(there.id)) return [start, end];

  const doors: Vec3[] = [];
  for (let id = there.id; id !== here.id; ) {
    const step = previous.get(id)!;
    doors.unshift(floor([step.door.x, 0, step.door.z]));
    id = step.room;
  }
  return [start, ...doors, end];
}

/** The route's length in metres. */
export function pathLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);
  return total;
}

/** The point `distance` metres along the route (clamped to its ends). */
export function pointAlong(points: readonly Vec3[], distance: number): Vec3 {
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]);
    if (left <= length || i === points.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, left / length);
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, FLOOR, points[i - 1][2] + (points[i][2] - points[i - 1][2]) * t];
    }
    left -= length;
  }
  return points[0] ?? [0, FLOOR, 0];
}
