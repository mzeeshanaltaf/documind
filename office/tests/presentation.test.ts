import { beforeEach, describe, expect, it } from "vitest";
import { DOCUMIND_DECK, EXPLAINER } from "@/content/documind-deck";
import { SIMTORA_LOCATIONS } from "@/content/orgs/simtora";
import { SIMTORA_DECK } from "@/content/orgs/simtora-deck";
import { npcProfile } from "@/game/npc/profiles";
import { bus, type GameEvent } from "@/game/quests/bus";
import { INITIAL_PRESENTATION, type OfficeContext, useGame } from "@/game/store/game-store";
import { buildFloorplan, insideRect, rectEdges } from "@/game/world/office/floorplan";
import { deckFor, decksFor, summaryParts } from "@/game/world/office/presentation/decks";
import { auditoriumLayout, LANE, RISE, ROWS, SCREEN_FRAME, SEATS_PER_ROW, seatCamera } from "@/game/world/office/presentation/layout";
import { type Deck, markSeen, pinPosition, programmeOf, type SeenSlides, slideSeconds, wrapSlide } from "@/game/world/office/presentation/slides";
import { seeSlide } from "@/game/world/office/presentation/use-programme";
import type { DocumentOut } from "@/lib/api-types";
import { roomDepartments } from "@/lib/departments";
import type { Location } from "@/lib/locations";
import { scopeFor } from "@/lib/scope";
import { codes, doc, SIMTORA } from "./fixtures/simtora-docs";

// Phase O7 › Tests: the decks (`deckFor`), the seen-set, the auditorium layout, the presenter.

describe("slideSeconds", () => {
  it("holds every text slide 15–20 s, longer for denser ones", () => {
    const texts = programmeOf(decksFor({ name: "Simtora Technologies", slug: "simtora" }, [])).filter((entry) => !entry.slide.video);
    for (const { slide } of texts) {
      expect(slideSeconds(slide)).toBeGreaterThanOrEqual(15);
      expect(slideSeconds(slide)).toBeLessThanOrEqual(20);
    }
    const sparse = { id: "s", kind: "title", title: "Hi", speakerLine: "", durationS: 10 } as const;
    const dense = { ...sparse, body: "word ".repeat(120).trim() };
    expect(slideSeconds(sparse)).toBe(15);
    expect(slideSeconds(dense)).toBe(20);
  });
});

const ACME = { name: "Acme Corp", slug: "acme" };
const ACME_DOCS = [
  { ...doc("ACM-OVR", "Corporate", "GLOBAL", "overview"), title: "Acme at a glance" },
  doc("ACM-HR-1", "HR", "GLOBAL", "policy_manual"),
  doc("ACM-HR-DE", "HR", "DE", "country_supplement"),
  doc("ACM-IT-1", "IT", "GLOBAL", "policy_manual"),
  doc("ACM-OLD", "Finance", "US", "policy_manual", false),
];

describe("deckFor", () => {
  it("Simtora gets its authored deck, after DocuMind's", () => {
    expect(deckFor({ name: "Simtora Technologies, Inc.", slug: "simtora" }, SIMTORA)).toBe(SIMTORA_DECK);
    const decks = decksFor({ name: "Simtora Technologies, Inc.", slug: "simtora" }, SIMTORA);
    expect(decks.map((d) => d.id)).toEqual(["documind", "company"]);
    expect(decks[0]).toBe(DOCUMIND_DECK);
  });

  it("an org with an overview document gets a title, its summary in parts, its library and its rooms", () => {
    const summary = "Acme makes rockets for the U.S. market. It was founded in 1949. It has offices in Berlin and Austin. Its values are speed and safety.";
    const docs = ACME_DOCS.map((d) => (d.doc_code === "ACM-OVR" ? { ...d, summary } : d));
    const deck = deckFor(ACME, docs);
    expect(deck.id).toBe("company");
    expect(deck.title).toBe("About Acme");
    expect(deck.slides.map((s) => s.id)).toEqual(["title", "summary-1", "summary-2", "summary-3", "library", "departments"]);
    expect(deck.slides[1].body).toBe("Acme makes rockets for the U.S. market. It was founded in 1949.");
    expect(deck.slides[1].source).toBe("From the summary of ACM-OVR");
    const library = deck.slides.find((s) => s.id === "library")!;
    // The unindexed Finance manual doesn't count; GLOBAL isn't a country.
    expect(library.stats?.map((s) => [s.label, s.value])).toEqual([
      ["Documents", "4"],
      ["Departments", "3"],
      ["Countries", "1"],
    ]);
    expect(library.stats?.[2].note).toBe("Germany");
    const rooms = deck.slides.find((s) => s.id === "departments")!;
    expect(rooms.items?.map((i) => i.room)).toEqual(roomDepartments(ACME_DOCS));
  });

  it("before the summary arrives, the overview still gives a title slide", () => {
    expect(deckFor(ACME, ACME_DOCS).slides.map((s) => s.id)).toEqual(["title", "library", "departments"]);
  });

  it("an org without an overview gets the stats and departments only", () => {
    const deck = deckFor(ACME, ACME_DOCS.filter((d) => d.doc_type !== "overview"));
    expect(deck.slides.map((s) => s.id)).toEqual(["library", "departments"]);
  });

  it("splits a summary into at most three parts, keeping abbreviations whole", () => {
    expect(summaryParts("One. Two.")).toEqual(["One.", "Two."]);
    expect(summaryParts("Founded in the U.S. in 2016. Based in S.F.")).toEqual(["Founded in the U.S. in 2016.", "Based in S.F."]);
    expect(summaryParts("A. B. C. D. E.")).toEqual(["A. B.", "C. D.", "E."]);
    expect(summaryParts("A. B. C. D.")).toEqual(["A. B.", "C.", "D."]);
  });
});

describe("the decks' content", () => {
  const decks = [DOCUMIND_DECK, SIMTORA_DECK];

  it("has about eight slides each, unique ids, a line and a time for every slide", () => {
    for (const deck of decks) {
      expect(deck.slides.length).toBe(8);
      expect(new Set(deck.slides.map((s) => s.id)).size).toBe(deck.slides.length);
      for (const slide of deck.slides) {
        expect(slide.speakerLine.length).toBeGreaterThan(10);
        expect(slide.durationS).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("cites the overview page on every Simtora slide", () => {
    for (const slide of SIMTORA_DECK.slides) expect(slide.source).toMatch(/^SIM-OVR-001 · pp?\. \d/);
  });

  it("uses no em dashes (DESIGN.md › Copy)", () => {
    expect(JSON.stringify(decks)).not.toMatch(/—/);
  });

  it("puts the six offices on the map and the explainer on the video slide", () => {
    const map = SIMTORA_DECK.slides.find((s) => s.kind === "map")!;
    expect(map.pins?.map((p) => p.id)).toEqual(SIMTORA_LOCATIONS.map((l) => l.id));
    expect(map.pins?.filter((p) => p.hq).map((p) => p.id)).toEqual(["san-francisco"]);
    const video = DOCUMIND_DECK.slides.find((s) => s.kind === "video")!;
    expect(video.video).toBe(EXPLAINER);
    expect(video.durationS).toBeGreaterThan(EXPLAINER.durationS);
  });

  it("links the policy framework to existing department rooms", () => {
    const framework = SIMTORA_DECK.slides.find((s) => s.id === "policy-framework")!;
    expect(framework.items?.map((i) => i.room).sort()).toEqual(roomDepartments(SIMTORA as DocumentOut[]).sort());
  });

  it("places pins equirectangularly", () => {
    expect(pinPosition({ lat: 0, lon: 0 })).toEqual({ x: 0.5, y: 0.5 });
    expect(pinPosition({ lat: 90, lon: -180 })).toEqual({ x: 0, y: 0 });
  });
});

describe("the programme and the seen-set", () => {
  const tiny: Deck = {
    id: "company",
    title: "Tiny",
    slides: ["a", "b"].map((id) => ({ id, kind: "title", title: id, speakerLine: "line", durationS: 10 })),
  };

  it("runs the decks back to back and wraps both ways", () => {
    const programme = programmeOf([DOCUMIND_DECK, tiny]);
    expect(programme).toHaveLength(10);
    expect(programme[8]).toMatchObject({ index: 0, total: 2 });
    expect(programme[8].deck.id).toBe("company");
    expect(wrapSlide(10, 10)).toBe(0);
    expect(wrapSlide(-1, 10)).toBe(9);
    expect(wrapSlide(3, 0)).toBe(0);
  });

  it("completes a deck once, on its last unseen slide", () => {
    let seen: SeenSlides = {};
    const first = markSeen(seen, tiny, "b");
    expect(first.completed).toBe(false);
    seen = first.seen;
    expect(markSeen(seen, tiny, "b").seen).toBe(seen);
    expect(markSeen(seen, tiny, "zzz").seen).toBe(seen);
    const last = markSeen(seen, tiny, "a");
    expect(last.completed).toBe(true);
    expect(markSeen(last.seen, tiny, "a").completed).toBe(false);
    expect(markSeen(last.seen, tiny, "b").completed).toBe(false);
  });

  it("emits presentation_watched once, after the last unseen slide (through the store)", () => {
    useGame.setState({ presentation: INITIAL_PRESENTATION, office: null });
    const events: GameEvent[] = [];
    const off = bus.on("presentation_watched", (event) => events.push(event));
    try {
      const programme = programmeOf([tiny]);
      seeSlide(programme[0]);
      expect(events).toHaveLength(0);
      seeSlide(programme[0]);
      seeSlide(programme[1]);
      expect(events).toEqual([{ type: "presentation_watched", deck: "company", location: undefined }]);
      seeSlide(programme[1]);
      seeSlide(programme[0]);
      expect(events).toHaveLength(1);
    } finally {
      off();
    }
  });
});

describe("the store's slide controls", () => {
  beforeEach(() => useGame.setState({ presentation: INITIAL_PRESENTATION }));

  it("steps and wraps within the programme, and keeps the slide in range when it shrinks", () => {
    const s = useGame.getState();
    s.setPresentationCount(16);
    s.stepSlide(-1);
    expect(useGame.getState().presentation.slide).toBe(15);
    useGame.getState().stepSlide(2);
    expect(useGame.getState().presentation.slide).toBe(1);
    useGame.getState().showSlide(12);
    useGame.getState().setPresentationCount(10);
    expect(useGame.getState().presentation.slide).toBe(2);
  });
});

describe("the auditorium layout", () => {
  const plan = buildFloorplan(roomDepartments(SIMTORA as DocumentOut[]));
  const room = plan.rooms.find((r) => r.kind === "presentation")!;
  const door = plan.doors.find((d) => d.to === "presentation")!;
  const layout = auditoriumLayout(room, door);
  const { x0, x1, z0, z1 } = rectEdges(room.rect);
  const inside = (box: { center: number[]; half: number[] }) =>
    box.center[0] - box.half[0] >= x0 - 1e-6 && box.center[0] + box.half[0] <= x1 + 1e-6 && box.center[2] - box.half[2] >= z0 - 1e-6 && box.center[2] + box.half[2] <= z1 + 1e-6;
  const hits = (x: number, z: number, y: number, r: number) =>
    layout.colliders.some(
      (c) =>
        Math.abs(x - c.center[0]) < c.half[0] + r &&
        Math.abs(z - c.center[2]) < c.half[2] + r &&
        y + 0.1 < c.center[1] + c.half[1] && // above a riser's top counts as standing on it
        y + 1.7 > c.center[1] - c.half[1],
    );

  it("seats 24 facing the screen, rising one step per row", () => {
    expect(layout.seats).toHaveLength(ROWS * SEATS_PER_ROW);
    expect(new Set(layout.seats.map((s) => s.id)).size).toBe(24);
    for (const seat of layout.seats) {
      expect(insideRect(room.rect, seat.position[0], seat.position[2], 0.3)).toBe(true);
      expect(seat.position[1]).toBeCloseTo(seat.row * RISE);
      expect(seat.yaw).toBeCloseTo(-Math.PI / 2);
    }
    // 0.2 m steps, under the character controller's 0.32 m autostep.
    expect(RISE).toBeLessThan(0.32);
  });

  it("keeps every solid piece inside the room, off the door and its aisle", () => {
    for (const collider of layout.colliders) expect(inside(collider)).toBe(true);
    // The door's opening and 1 m in front of it.
    for (let z = door.z - door.width / 2 + 0.3; z <= door.z + door.width / 2 - 0.3; z += 0.2) {
      expect(hits(x1 - 0.5, z, 0, 0.28)).toBe(false);
      expect(hits(x1 - 1.2, z, 0, 0.28)).toBe(false);
    }
    // The south aisle, level, from the door to the front.
    for (let x = layout.stageStep.center[0] + 0.6; x <= x1 - 0.5; x += 0.25) expect(hits(x, layout.rowSpan.z1 + 0.6, 0, 0.28)).toBe(false);
  });

  it("leaves a walkable lane along the rows and room in front of every seat", () => {
    expect(LANE).toBeGreaterThan(0.56 + 0.2);
    for (const row of layout.rows) {
      const z = layout.rowSpan.z1 - LANE / 2;
      expect(hits((row.x0 + row.x1) / 2, z, row.height, 0.28)).toBe(false);
    }
    for (const seat of layout.seats) {
      // Where "E · Sit" is offered, and where standing up puts the player (0.6 m in front).
      expect(hits(seat.position[0] - 0.62, seat.position[2], seat.position[1], 0.2)).toBe(false);
      expect(hits(seat.position[0] - 0.6, seat.position[2], seat.position[1], 0.28)).toBe(false);
    }
  });

  it("hangs a 16:9 screen on the west wall under the ceiling, centred on the seats", () => {
    const { center, width, height } = layout.screen;
    expect(width / height).toBeCloseTo(16 / 9, 2);
    expect(center[0]).toBeLessThan(x0 + 0.3);
    // In front of its frame's face, or the frame hides the plane (the video slide went black).
    expect(center[0]).toBeGreaterThan(x0 + SCREEN_FRAME.offset + SCREEN_FRAME.depth / 2);
    expect(center[1] + height / 2).toBeLessThan(3.2);
    expect(center[1] - height / 2).toBeGreaterThan(layout.stage.center[1] + layout.stage.half[1]);
    const zs = layout.seats.map((s) => s.position[2]);
    expect(center[2]).toBeCloseTo((Math.min(...zs) + Math.max(...zs)) / 2);
  });

  it("puts the presenter on the stage, clear of the lectern and beside the screen", () => {
    const [px, py, pz] = layout.presenter.position;
    expect(py).toBeCloseTo(layout.stage.center[1] + layout.stage.half[1]);
    expect(hits(px, pz, py, 0.28)).toBe(false);
    expect(Math.abs(pz - layout.screen.center[2])).toBeGreaterThan(layout.screen.width / 2);
  });

  it("frames the screen from every seat at most 4.7 m away", () => {
    for (const seat of layout.seats) {
      const eye = seatCamera(seat, layout.screen.center);
      const distance = Math.hypot(eye[0] - layout.screen.center[0], eye[1] - layout.screen.center[1], eye[2] - layout.screen.center[2]);
      expect(distance).toBeLessThanOrEqual(4.7 + 1e-6);
      expect(eye[0]).toBeGreaterThan(layout.stage.center[0]);
    }
  });
});

function office(documents: DocumentOut[], slug = "simtora"): OfficeContext {
  const place: Location = {
    id: "lahore",
    name: "Lahore",
    country: "PK",
    role: "office",
    roleLabel: "R&D centre",
    lat: 0,
    lon: 0,
    timezone: "UTC",
    landmarkKit: "generic",
    palette: { ground: "#000", buildings: [], accent: "#000", floors: [1, 2] },
    docCodes: [],
  };
  return { org: { id: "org-1", name: slug === "simtora" ? "Simtora Technologies, Inc." : "Acme Corp", slug }, place, documents, me: { id: "u", email: "u@example.com", name: "U", is_admin: false } };
}

describe("the presenter", () => {
  it("answers from the overview only, with Simtora's suggested questions", () => {
    const profile = npcProfile("presenter", office(SIMTORA as DocumentOut[]))!;
    expect(codes(profile.scope.documentIds)).toEqual(["SIM-OVR-001"]);
    expect(profile.scope.fallback).toBe(false);
    expect(profile.menu).toBe(false);
    expect(profile.department).toBeNull();
    expect(profile.suggestions).toEqual(["When was Simtora founded?", "Where are the R&D centres?", "What are the company values?"]);
    expect(profile.greeting).toMatch(/company overview/);
  });

  it("falls back to the office's documents when there's no overview", () => {
    const docs = ACME_DOCS.filter((d) => d.doc_type !== "overview") as DocumentOut[];
    const profile = npcProfile("presenter", office(docs, "acme"))!;
    expect(profile.scope.fallback).toBe(true);
    expect(codes(profile.scope.documentIds)).toEqual(["ACM-HR-1", "ACM-IT-1"]);
    expect(profile.suggestions[0]).toBe("What does Acme do?");
    expect(profile.greeting).toMatch(/no company overview/);
    // Worldwide: unscoped, like reception.
    expect(scopeFor(docs, { country: null, overviewOnly: true }).documentIds).toBeNull();
  });
});
