import { describe, expect, it } from "vitest";
import { receptionCallout, receptionGreeting, receptionistFor, receptionSuggestions } from "@/content/personas";
import { themeFor } from "@/content/room-themes";
import { buildFloorplan, insideRect, reachableRooms, rectEdges, roomAt, roomsOverlap } from "@/game/world/office/floorplan";
import { OFFICE_SPAWNS } from "@/game/world/office/spawns";
import type { DocumentOut } from "@/lib/api-types";
import { orderDepartments, roomDepartments } from "@/lib/departments";
import { quotaLevel } from "@/lib/quota";
import { MAX_SCOPE, type ScopeDocument, scopeFor } from "@/lib/scope";

// Phase O5 › Tests: the floor plan, the departments, reception's scope, personas and the quota.

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

function doc(code: string, department: string, jurisdiction: string, doc_type: string, indexed = true): ScopeDocument {
  return { id: `id-${code}`, title: code, doc_code: code, department, jurisdiction, doc_type, indexed_at: indexed ? "2026-10-01T00:00:00Z" : null };
}

// Simtora's corpus (the dev DB, 2026-10-22).
const SIMTORA: ScopeDocument[] = [
  doc("SIM-CMP-001", "Compliance", "GLOBAL", "policy_manual"),
  doc("SIM-FAC-001", "Facilities", "GLOBAL", "policy_manual"),
  doc("SIM-FIN-001", "Finance", "GLOBAL", "policy_manual"),
  doc("SIM-GLB-001", "International", "GLOBAL", "global_supplement"),
  doc("SIM-HR-001", "HR", "US", "policy_manual"),
  doc("SIM-HR-002", "HR", "GLOBAL", "global_supplement"),
  doc("SIM-HR-101", "HR", "PK", "country_supplement"),
  doc("SIM-HR-102", "HR", "DE", "country_supplement"),
  doc("SIM-HR-103", "HR", "FR", "country_supplement"),
  doc("SIM-HR-104", "HR", "AU", "country_supplement"),
  doc("SIM-HR-105", "HR", "GB", "country_supplement"),
  doc("SIM-IT-001", "IT", "GLOBAL", "policy_manual"),
  doc("SIM-OVR-001", "Corporate", "GLOBAL", "overview"),
  doc("SIM-PRC-001", "Procurement", "GLOBAL", "policy_manual"),
];
const codes = (ids: string[] | null) => (ids ?? []).map((id) => id.replace("id-", "")).sort();

describe("scopeFor (reception, rule 4)", () => {
  it("Lahore reception gets every GLOBAL, base and PK document, and no other country's", () => {
    const scope = scopeFor(SIMTORA, { country: "PK", placeName: "Lahore" });
    expect(codes(scope.documentIds)).toEqual(
      ["SIM-CMP-001", "SIM-FAC-001", "SIM-FIN-001", "SIM-GLB-001", "SIM-HR-001", "SIM-HR-002", "SIM-HR-101", "SIM-IT-001", "SIM-OVR-001", "SIM-PRC-001"].sort(),
    );
    expect(scope.label).toBe("Answers from 10 Lahore documents");
    expect(scope.fallback).toBe(false);
    // Local first: what survives the 50-document cap.
    expect(scope.documents[0].doc_code).toBe("SIM-HR-101");
  });

  it("Worldwide reception is unscoped (DocuMind routes)", () => {
    const scope = scopeFor(SIMTORA, { country: null, placeName: "Global Hub" });
    expect(scope.documentIds).toBeNull();
    expect(scope.documents).toHaveLength(14);
    expect(scope.label).toBe("Answers from all 14 documents");
  });

  it("leaves out unindexed documents", () => {
    const scope = scopeFor([...SIMTORA, doc("SIM-HR-106", "HR", "PK", "country_supplement", false)], { country: "PK" });
    expect(codes(scope.documentIds)).not.toContain("SIM-HR-106");
  });

  it("caps at 50 documents, local ones first", () => {
    const many = Array.from({ length: 60 }, (_, i) => doc(`G-${i}`, "IT", "GLOBAL", "procedure"));
    const scope = scopeFor([...many, doc("L-1", "IT", "PK", "country_supplement")], { country: "PK" });
    expect(scope.documentIds).toHaveLength(MAX_SCOPE);
    expect(scope.documentIds?.[0]).toBe("id-L-1");
  });

  it("department rooms (rules 2, 3 and 6) for O6", () => {
    expect(codes(scopeFor(SIMTORA, { department: "HR", country: "PK" }).documentIds)).toEqual(["SIM-HR-001", "SIM-HR-002", "SIM-HR-101"]);
    expect(scopeFor(SIMTORA, { department: "HR", country: null }).documentIds).toHaveLength(7);
    expect(codes(scopeFor(SIMTORA, { department: "Finance", country: "PK" }).documentIds)).toEqual(["SIM-FIN-001"]);
    const fallback = scopeFor([doc("X-1", "Legal", "DE", "country_supplement")], { department: "Legal", country: "PK" });
    expect(fallback).toMatchObject({ fallback: true, documentIds: ["id-X-1"] });
    expect(codes(scopeFor(SIMTORA, { country: "PK", overviewOnly: true }).documentIds)).toEqual(["SIM-OVR-001"]);
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

// A DocumentOut's other fields don't matter to scoping; this keeps the fixture honest.
const _typecheck: Pick<DocumentOut, keyof ScopeDocument> = SIMTORA[0];
void _typecheck;
