import { describe, expect, it } from "vitest";
import { receptionCallout, receptionGreeting, receptionistFor, receptionSuggestions } from "@/content/personas";
import { themeFor } from "@/content/room-themes";
import { buildFloorplan, insideRect, reachableRooms, rectEdges, roomAt, roomsOverlap } from "@/game/world/office/floorplan";
import { OFFICE_SPAWNS } from "@/game/world/office/spawns";
import { orderDepartments, roomDepartments } from "@/lib/departments";
import { quotaLevel } from "@/lib/quota";

// Phase O5 › Tests: the floor plan, the departments, personas and the quota (scope: scope.test.ts).

const SIMTORA_DEPARTMENTS = ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "Corporate", "International"];

describe("room departments", () => {
  it("orders the known departments first, then the rest alphabetically, without Corporate", () => {
    expect(orderDepartments(["Legal", "Corporate", "IT", "HR", "Operations", "HR", " "])).toEqual(["HR", "IT", "Legal", "Operations"]);
  });

  it("takes them from searchable documents only", () => {
    const docs = [
      { department: "Finance", indexed_at: "2026-10-01" },
      { department: "Legal", indexed_at: null },
      { department: null, indexed_at: "2026-10-01" },
      { department: "Corporate", indexed_at: "2026-10-01" },
    ];
    expect(roomDepartments(docs)).toEqual(["Finance"]);
  });
});

describe("buildFloorplan", () => {
  const plan = buildFloorplan(SIMTORA_DEPARTMENTS);
  const departmentRooms = plan.rooms.filter((room) => room.kind === "department");

  it("gives Simtora 7 department rooms (no Corporate), in order, alternating sides", () => {
    expect(departmentRooms.map((room) => room.department)).toEqual(["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International"]);
    expect(departmentRooms.map((room) => room.side)).toEqual(["west", "east", "west", "east", "west", "east", "west"]);
    expect(plan.rooms.map((room) => room.kind).filter((kind) => kind !== "department")).toEqual(["lobby", "presentation", "play", "corridor"]);
  });

  it("makes the corridor ceil(n/2) bays long, plus the lift landing", () => {
    const corridor = plan.rooms.find((room) => room.id === "corridor")!;
    expect(corridor.rect.d).toBe(Math.ceil(7 / 2) * 8 + 4);
    const lift = plan.doors.find((door) => door.kind === "lift")!;
    expect(lift.z).toBeCloseTo(rectEdges(corridor.rect).z0);
    expect(lift.requires).toBe("unlock:rooftop");
  });

  it("never overlaps two rooms", () => {
    for (const [i, a] of plan.rooms.entries()) {
      for (const b of plan.rooms.slice(i + 1)) expect(roomsOverlap(a.rect, b.rect), `${a.id} × ${b.id}`).toBe(false);
    }
  });

  it("reaches every room from the lobby through doors", () => {
    const reached = reachableRooms(plan, "lobby");
    for (const room of plan.rooms) expect(reached.has(room.id), room.id).toBe(true);
  });

  it("gates each department room with its own card, and the corridor with any card", () => {
    for (const room of departmentRooms) {
      const doors = plan.doors.filter((door) => door.to === room.id || door.from === room.id);
      expect(doors).toHaveLength(1);
      expect(doors[0].requires).toBe(`card:${room.department}`);
    }
    expect(plan.doors.find((door) => door.kind === "security")?.requires).toBe("card:*");
    expect(plan.doors.filter((door) => door.kind === "open").map((door) => door.to)).toEqual(["presentation", "play"]);
  });

  it("cuts every door out of its wall and puts each door on its rooms' shared edge", () => {
    const onEdge = (roomId: string, door: (typeof plan.doors)[number]) => {
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room) return true; // street, rooftop
      const { x0, x1, z0, z1 } = rectEdges(room.rect);
      return door.orient === "h"
        ? [z0, z1].some((z) => Math.abs(z - door.z) < 1e-6) && door.x > x0 && door.x < x1
        : [x0, x1].some((x) => Math.abs(x - door.x) < 1e-6) && door.z > z0 && door.z < z1;
    };
    for (const door of plan.doors) {
      expect(onEdge(door.from, door) && onEdge(door.to, door), door.id).toBe(true);
      const blocking = plan.walls.filter(
        (wall) =>
          wall.kind !== "header" &&
          wall.orient === door.orient &&
          (door.orient === "h"
            ? Math.abs(wall.center[2] - door.z) < 1e-6 && Math.abs(wall.center[0] - door.x) < wall.half[0]
            : Math.abs(wall.center[0] - door.x) < 1e-6 && Math.abs(wall.center[2] - door.z) < wall.half[2]),
      );
      expect(blocking, door.id).toHaveLength(0);
    }
  });

  it("keeps walls closed apart from the doors (no gap a player fits through)", () => {
    const lobby = plan.rooms[0];
    const north = rectEdges(lobby.rect).z0;
    const covered = plan.walls
      .filter((wall) => wall.kind !== "header" && wall.orient === "h" && Math.abs(wall.center[2] - north) < 1e-6)
      .map((wall) => [wall.center[0] - wall.half[0], wall.center[0] + wall.half[0]] as const)
      .sort((a, b) => a[0] - b[0]);
    // Along the lobby's north wall the only opening is the 2 m security door at x = 0.
    const gaps: [number, number][] = [];
    for (let i = 1; i < covered.length; i++) if (covered[i][0] > covered[i - 1][1] + 1e-6) gaps.push([covered[i - 1][1], covered[i][0]]);
    expect(gaps).toEqual([[-1, 1]]);
  });

  it("uses glass for the department rooms' corridor walls", () => {
    expect(plan.walls.some((wall) => wall.kind === "glass")).toBe(true);
    for (const wall of plan.walls.filter((w) => w.kind === "glass")) expect(Math.abs(wall.center[0])).toBeCloseTo(1.6);
  });

  it("places spawns, NPCs and the exit sensibly", () => {
    const lobby = plan.rooms[0];
    const [sx, , sz] = plan.spawns.lobby_entrance.position;
    expect(insideRect(lobby.rect, sx, sz, 0.5)).toBe(true);
    expect(OFFICE_SPAWNS.lobby_entrance.position).toEqual(plan.spawns.lobby_entrance.position);
    const [rx, , rz] = plan.npcSpots.reception.position;
    expect(roomAt(plan, rx, rz)?.id).toBe("lobby");
    for (const room of departmentRooms) {
      const [ex, , ez] = plan.npcSpots[`expert:${room.department}`].position;
      expect(roomAt(plan, ex, ez)?.id).toBe(room.id);
    }
    expect(plan.exit.center[2]).toBeGreaterThan(rectEdges(lobby.rect).z1);
  });

  it("handles orgs with one department or none", () => {
    const one = buildFloorplan(["Finance"]);
    expect(one.rooms.filter((room) => room.kind === "department")).toHaveLength(1);
    expect(reachableRooms(one).size).toBe(one.rooms.length);
    const none = buildFloorplan([]);
    expect(none.rooms.map((room) => room.id)).toEqual(["lobby", "presentation", "play", "corridor"]);
    expect(none.rooms[0]).toEqual(plan.rooms[0]);
  });
});

describe("personas and themes", () => {
  const lahore = { id: "lahore", name: "Lahore", role: "office" as const, country: "PK" };
  const hub = { id: "worldwide", name: "Global Hub", role: "hub" as const, country: null };

  it("gives Simtora a receptionist per city and other orgs a generic one", () => {
    expect(receptionistFor("simtora", lahore).name).toBe("Sara Malik");
    expect(receptionistFor("acme", lahore).name).toBe("Alex Morgan");
    expect(new Set(["san-francisco", "lahore", "berlin", "paris", "sydney", "london", "worldwide"].map((id) => receptionistFor("simtora", { ...lahore, id }).name)).size).toBe(7);
  });

  it("greets and calls out with the org's short name", () => {
    const sara = receptionistFor("simtora", lahore);
    expect(receptionCallout("Simtora Technologies", lahore)).toBe("Welcome to Simtora Lahore! Come get your badge.");
    expect(receptionGreeting(sara, "Simtora Technologies", lahore)).toMatch(/^Welcome to Simtora Lahore! I'm Sara\./);
    expect(receptionCallout("Simtora Technologies", hub)).toBe("Welcome to the Simtora Global Hub! Come get your badge.");
  });

  it("flavours reception's suggestions by country", () => {
    expect(receptionSuggestions(lahore)[0]).toBe("How many days of annual leave do I get in Pakistan?");
    expect(receptionSuggestions({ ...lahore, country: "US" })[0]).toBe("How many days of annual leave do I get in the United States?");
    expect(receptionSuggestions(hub)).toHaveLength(3);
  });

  it("has a theme for every Simtora room and a generic one", () => {
    for (const department of orderDepartments(SIMTORA_DEPARTMENTS)) expect(themeFor(department).blurb).not.toBe(themeFor("Unknown").blurb);
  });
});

describe("quotaLevel", () => {
  const quota = (messages_used: number, tokens_used: number, exhausted: "messages" | "tokens" | null = null) => ({
    message_limit: 25,
    token_limit: 100_000,
    messages_used,
    tokens_used,
    exhausted,
    unlimited: false,
  });

  it("is amber at ≤ 3 messages left or ≥ 90% tokens, red when used up", () => {
    expect(quotaLevel(quota(18, 64_000))).toBe("ok");
    expect(quotaLevel(quota(22, 10_000))).toBe("low");
    expect(quotaLevel(quota(5, 90_000))).toBe("low");
    expect(quotaLevel(quota(25, 10_000, "messages"))).toBe("exhausted");
    expect(quotaLevel(quota(3, 100_500))).toBe("exhausted");
    expect(quotaLevel({ ...quota(25, 0, "messages"), unlimited: true })).toBe("ok");
  });
});
