import { beforeEach, describe, expect, it } from "vitest";
import { escapeHtml, normalizePassage, normalizeText, shouldHighlight } from "@/components/pdf/highlight";
import { expertFor, expertGreeting } from "@/content/personas";
import { type Decor, ROOM_THEMES, roomSuggestions, themeFor } from "@/content/room-themes";
import { citationTargets, viewerRequest } from "@/game/chat/citations";
import { newTurn } from "@/game/chat/sse";
import { npcProfile, scopeCountries } from "@/game/npc/profiles";
import { EMPTY_THREAD, type OfficeContext, threadKey, useGame } from "@/game/store/game-store";
import { buildFloorplan, expertLocal, roomAt, roomFrame, toWorld } from "@/game/world/office/floorplan";
import { handAngles, zoneTime } from "@/game/world/office/rooms/animated";
import { keepClear, type LocalBox, roomDecor } from "@/game/world/office/rooms/decor";
import { screenContent } from "@/game/world/office/rooms/panels";
import type { Citation, DocumentOut, Source } from "@/lib/api-types";
import type { Location } from "@/lib/locations";
import { codes, SIMTORA } from "./fixtures/simtora-docs";

// Phase O6 › Tests: the rooms' decor stays out of the way, the experts, the Worldwide country
// chips, citations → the viewer, the highlight helper, and the time-zone clocks.

const ROOM = { width: 8, depth: 8 };
const DECORS: Decor[] = ["hr", "it", "finance", "procurement", "facilities", "compliance", "international", "generic"];

/** Distance from a point to a box's footprint (0 inside). */
function gap(box: LocalBox, x: number, z: number) {
  const dx = Math.max(0, Math.abs(x - box.center[0]) - box.half[0]);
  const dz = Math.max(0, Math.abs(z - box.center[2]) - box.half[2]);
  return Math.hypot(dx, dz);
}

describe("room decor", () => {
  const clear = keepClear(ROOM);

  it.each(DECORS)("%s: colliders stay inside the room, off the doorway and away from the expert", (decor) => {
    const set = roomDecor(decor, "#c26a3f", ROOM, { offices: 6 });
    expect(set.parts.length).toBeGreaterThan(10);
    expect(set.colliders.length).toBeGreaterThan(2);
    for (const box of set.colliders) {
      expect(Math.abs(box.center[0]) + box.half[0]).toBeLessThanOrEqual(ROOM.width / 2 - 0.1 + 1e-6);
      expect(Math.abs(box.center[2]) + box.half[2]).toBeLessThanOrEqual(ROOM.depth / 2 - 0.1 + 1e-6);
      // The doorway and 1.2 m in front of it.
      expect(gap(box, clear.door.x + 0.6, 0), JSON.stringify(box)).toBeGreaterThan(0.85);
      // Room to stand and talk: 0.75 m round the expert (their own desk is behind them).
      expect(gap(box, clear.expert.x - 0.75, clear.expert.z), JSON.stringify(box)).toBeGreaterThan(0.35);
      // The way from the door to the expert is free (sampled every 25 cm, 45 cm wide).
      for (let t = 0; t <= 1; t += 0.05) {
        const x = clear.door.x + 0.5 + (clear.expert.x - 0.8 - (clear.door.x + 0.5)) * t;
        const z = clear.expert.z * t;
        expect(gap(box, x, z), `${decor} blocks the way at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThan(0.45);
      }
    }
  });

  it("every room has the wall screen; each set brings its own panels and moving parts", () => {
    const ids = (decor: Decor) => roomDecor(decor, "#000000", ROOM).panels.map((panel) => panel.id);
    for (const decor of DECORS) expect(ids(decor)).toContain("screen");
    expect(ids("hr")).toEqual(expect.arrayContaining(["people", "calendar"]));
    expect(ids("it")).toContain("poster-it");
    expect(ids("finance")).toEqual(expect.arrayContaining(["chart-bars", "chart-line"]));
    expect(ids("facilities")).toEqual(expect.arrayContaining(["blueprint", "recycling"]));
    expect(ids("compliance")).toContain("poster-speakup");
    expect(ids("international")).toEqual(expect.arrayContaining(["map", "clock-labels"]));
    expect(ids("generic")).toContain("whiteboard");
    expect(roomDecor("it", "#000000", ROOM).leds.length).toBeGreaterThan(20);
    expect(roomDecor("international", "#000000", ROOM, { offices: 6 }).clocks).toHaveLength(6);
    expect(roomDecor("international", "#000000", ROOM, { offices: 2 }).clocks).toHaveLength(2);
    expect(roomDecor("hr", "#000000", ROOM).clocks).toHaveLength(0);
  });

  it("gives every Simtora department a decor set and unknown ones the meeting room", () => {
    expect(Object.values(ROOM_THEMES).map((theme) => theme.decor).toSorted()).toEqual(DECORS.filter((d) => d !== "generic").toSorted());
    expect(themeFor("Legal").decor).toBe("generic");
  });
});

describe("room frames", () => {
  const plan = buildFloorplan(["HR", "IT", "Finance"]);

  it("turns west rooms half round, so the door is always at local -x", () => {
    for (const room of plan.rooms.filter((r) => r.kind === "department")) {
      const frame = roomFrame(room);
      const door = plan.doors.find((d) => d.to === room.id)!;
      const [dx, , dz] = toWorld(frame, [-frame.width / 2, 0, 0]);
      expect(dx).toBeCloseTo(door.x);
      expect(dz).toBeCloseTo(door.z);
      const spot = plan.npcSpots[`expert:${room.department}`];
      expect(spot.position).toEqual(toWorld(frame, expertLocal(frame)));
      expect(roomAt(plan, spot.position[0], spot.position[2])?.id).toBe(room.id);
      // The expert faces the door: heading 0 is +z, so the door lies along (sin, cos) of the yaw.
      const towards = Math.atan2(door.x - spot.position[0], door.z - spot.position[2]);
      expect(Math.abs(Math.atan2(Math.sin(towards - spot.yaw), Math.cos(towards - spot.yaw)))).toBeLessThan(0.25);
    }
  });
});

describe("experts", () => {
  const lahore = { id: "lahore", name: "Lahore", role: "office" as const, country: "PK" };
  const hub = { id: "worldwide", name: "Global Hub", role: "hub" as const, country: null };
  const cities = ["san-francisco", "lahore", "berlin", "paris", "sydney", "london", "worldwide"];
  const departments = Object.keys(ROOM_THEMES);

  it("has a named Simtora expert per department in every office, and generic ones elsewhere", () => {
    for (const city of cities) {
      const names = departments.map((department) => expertFor("simtora", { ...lahore, id: city }, department).name);
      expect(new Set(names).size, city).toBe(departments.length);
    }
    expect(expertFor("simtora", lahore, "HR")).toMatchObject({ id: "expert:HR", name: "Hina Raza", role: "HR", prop: "clipboard" });
    expect(expertFor("acme", lahore, "HR").name).toBe("Sam Rivera");
    expect(expertFor("acme", lahore, "Underwater Basket Weaving").name).toBe("Jordan Lee");
    expect(expertFor("simtora", lahore, "IT").colors.top).toBe(themeFor("IT").accent);
  });

  it("greets as the phase doc says", () => {
    const hina = expertFor("simtora", lahore, "HR");
    expect(expertGreeting(hina, lahore, "HR")).toBe(
      "Hi, I'm Hina, I look after People & HR for the Lahore team. Ask me anything about your leave, benefits or policies.",
    );
    expect(expertGreeting(expertFor("simtora", hub, "HR"), hub, "HR")).toMatch(/^Hi, I'm Sofia, I look after People & HR across all our offices\./);
  });

  it("suggests location-flavoured questions to Simtora, generic ones to others", () => {
    expect(roomSuggestions("HR", "simtora", { country: "PK", city: "Lahore" })[0]).toBe("How many days of annual leave do I get in Pakistan?");
    expect(roomSuggestions("HR", "simtora", { country: "GB", city: "London" })[0]).toBe("How many days of annual leave do I get in the United Kingdom?");
    expect(roomSuggestions("HR", "acme", { country: "PK", city: "Lahore" })).toEqual(themeFor("HR").suggestedQuestions);
    expect(roomSuggestions("HR", "simtora", { country: null, city: "Global Hub" })).toEqual(themeFor("HR").suggestedQuestions);
    for (const theme of Object.values(ROOM_THEMES)) {
      expect(theme.suggestedQuestions.length).toBeGreaterThanOrEqual(3);
      expect(theme.suggestedQuestions.length).toBeLessThanOrEqual(5);
    }
  });
});

function office(place: Partial<Location> & Pick<Location, "id" | "name" | "country" | "role">): OfficeContext {
  return {
    org: { id: "org-1", name: "Simtora Technologies", slug: "simtora" },
    place: { roleLabel: "Office", lat: 0, lon: 0, timezone: "UTC", landmarkKit: "generic", palette: { ground: "#000", buildings: [], accent: "#000", floors: [1, 2] }, docCodes: [], ...place },
    documents: SIMTORA as DocumentOut[],
    me: { id: "u", email: "u@example.com", name: "U", is_admin: false },
  };
}

describe("expert profiles and the Worldwide country chips", () => {
  const lahore = office({ id: "lahore", name: "Lahore", country: "PK", role: "office" });
  const hub = office({ id: "worldwide", name: "Global Hub", country: null, role: "hub" });

  it("scopes a country office's expert to the department there", () => {
    const profile = npcProfile("expert:HR", lahore)!;
    expect(profile.menu).toBe(false);
    expect(codes(profile.scope.documentIds)).toEqual(["SIM-HR-001", "SIM-HR-002", "SIM-HR-101"]);
    expect(profile.scope.label).toBe("HR · Lahore · 3 documents");
    expect(profile.countries).toEqual([]);
    // A chip means nothing outside Worldwide.
    expect(codes(npcProfile("expert:HR", lahore, "DE")!.scope.documentIds)).toEqual(["SIM-HR-001", "SIM-HR-002", "SIM-HR-101"]);
  });

  it("offers the supplements' countries, then the base manual's, in Worldwide HR only", () => {
    expect(scopeCountries(SIMTORA, "HR")).toEqual(["PK", "DE", "FR", "AU", "GB", "US"]);
    expect(scopeCountries(SIMTORA, "IT")).toEqual([]);
    expect(npcProfile("expert:IT", hub)!.countries).toEqual([]);
    const all = npcProfile("expert:HR", hub)!;
    expect(all.countries).toEqual(["PK", "DE", "FR", "AU", "GB", "US"]);
    expect(all.country).toBeNull();
    expect(all.scope.documentIds).toHaveLength(7);
  });

  it("applies rule 2 for the chosen chip, and ignores a chip that isn't offered", () => {
    const germany = npcProfile("expert:HR", hub, "DE")!;
    expect(germany.country).toBe("DE");
    expect(codes(germany.scope.documentIds)).toEqual(["SIM-HR-001", "SIM-HR-002", "SIM-HR-102"]);
    expect(germany.scope.label).toBe("HR · Germany · 3 documents");
    expect(germany.suggestions[0]).toBe("How many days of annual leave do I get in Germany?");
    expect(npcProfile("expert:HR", hub, "JP")!.country).toBeNull();
  });
});

describe("the chip and viewer state", () => {
  beforeEach(() => useGame.setState({ chat: {}, scopeCountry: {}, viewer: { open: false, request: null }, modal: null }));

  it("a new chip starts a new conversation", () => {
    const key = threadKey("worldwide", "expert:HR");
    useGame.getState().updateThread(key, () => ({ conversationId: "c-1", turns: [newTurn("t", "Q?", null)] }));
    useGame.getState().setScopeCountry(key, "DE");
    expect(useGame.getState().chat[key]).toBe(EMPTY_THREAD);
    expect(useGame.getState().scopeCountry[key]).toBe("DE");
  });

  it("each citation click is a new request; closing the dialogue closes the sheet", () => {
    const request = { documentId: "d", title: "T", docCode: null, page: 3, pageEnd: 3, highlightText: null, npc: "expert:HR", department: "HR" };
    useGame.getState().openViewer(request);
    useGame.getState().openViewer({ ...request, page: 5 });
    expect(useGame.getState().viewer).toMatchObject({ open: true, request: { page: 5, nonce: 2 } });
    useGame.getState().closeModal();
    expect(useGame.getState().viewer.open).toBe(false);
    expect(useGame.getState().viewer.request?.page).toBe(5);
  });
});

describe("citations", () => {
  const source = (n: number, page: number): Source => ({
    n,
    document_id: `doc-${n}`,
    doc_code: `SIM-HR-10${n}`,
    title: `Manual ${n}`,
    section_number: "5.2",
    section_title: "Annual leave",
    page_start: page,
    page_end: page + 1,
    jurisdiction: "PK",
  });

  it("prefers the citation (with its passage) over the live source, and lists only cited ones", () => {
    const citation: Citation = { ...source(2, 16), chunk_id: "c", section_path: ["Part 5", "Annual leave"], snippet: "Employees…", highlight_text: "Employees get 14 days." };
    const { byNumber, cited } = citationTargets({ sources: [source(1, 4), source(2, 16)], citations: [citation] });
    expect(byNumber.get(1)?.highlight_text).toBeUndefined();
    expect(byNumber.get(2)?.highlight_text).toBe("Employees get 14 days.");
    expect(cited.map((c) => c.n)).toEqual([2]);
  });

  it("opens the viewer at the first cited page with the passage, and knows the department", () => {
    const target = { ...source(1, 16), highlight_text: "Employees get 14 days." };
    expect(viewerRequest(target, "expert:HR", [{ id: "doc-1", department: "HR" }])).toEqual({
      documentId: "doc-1",
      title: "Manual 1",
      docCode: "SIM-HR-101",
      page: 16,
      pageEnd: 17,
      highlightText: "Employees get 14 days.",
      npc: "expert:HR",
      department: "HR",
    });
    expect(viewerRequest({ ...source(1, 3), text: "Chunk text." }, null, []).highlightText).toBe("Chunk text.");
  });

  it("the room's screen shows the open document and its page", () => {
    const room = { department: "HR", accent: "#c26a3f", expert: "Hina", blurb: "Leave" };
    expect(screenContent(room, null)).toMatchObject({ kind: "room", department: "HR", expert: "Hina" });
    expect(screenContent(room, { docCode: "SIM-HR-101", title: "Pakistan supplement", page: 16, pageEnd: 17 })).toMatchObject({
      kind: "document",
      docCode: "SIM-HR-101",
      page: "pp. 16–17",
    });
  });
});

describe("highlight helper (components/pdf/highlight.ts)", () => {
  // A chunk as the chunker stores it (Markdown table pipes, curly quotes, a soft hyphen) and the
  // text items pdf.js returns for the same page.
  const chunk = `5.2 Annual leave
Employees in Pakistan are entitled to **14 working days** of paid annual leave per year.
| Service | Days |
| Under 5 years | 14 |
Leave can’t be carried over—except with the manager’s approval.`;
  const passage = normalizePassage(chunk);

  it("normalizes quotes, dashes, case and whitespace", () => {
    expect(normalizeText("  Leave CAN’T  be\ncarried “over” — ")).toBe(`leave can't be carried "over" -`);
    expect(passage).not.toMatch(/[|*]/);
  });

  it("marks the items inside the passage, and nothing too short or outside it", () => {
    expect(shouldHighlight("Employees in Pakistan are entitled to", passage)).toBe(true);
    expect(shouldHighlight("14 working days", passage)).toBe(true);
    expect(shouldHighlight("Leave can't be carried over-except", passage)).toBe(true);
    expect(shouldHighlight("Under 5 years", passage)).toBe(true);
    expect(shouldHighlight("of", passage)).toBe(false);
    expect(shouldHighlight("14", passage)).toBe(false);
    expect(shouldHighlight("Employees in Germany are entitled to", passage)).toBe(false);
  });

  it("escapes HTML in text items", () => {
    expect(escapeHtml(`<b>"A&B"</b>`)).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
  });
});

describe("time-zone clocks", () => {
  it("reads the local time in each office", () => {
    const at = new Date("2026-10-22T12:30:00Z");
    expect(zoneTime(at, "Asia/Karachi")).toEqual({ hours: 17, minutes: 30, seconds: 0 });
    expect(zoneTime(at, "Australia/Sydney")).toEqual({ hours: 23, minutes: 30, seconds: 0 });
    expect(zoneTime(at, "America/Los_Angeles").hours).toBe(5);
  });

  it("turns the hands clockwise from twelve", () => {
    expect(handAngles({ hours: 3, minutes: 0, seconds: 0 })).toEqual({ hour: Math.PI / 2, minute: 0 });
    const half = handAngles({ hours: 18, minutes: 30, seconds: 0 });
    expect(half.hour).toBeCloseTo(Math.PI + Math.PI / 12);
    expect(half.minute).toBeCloseTo(Math.PI);
  });
});
