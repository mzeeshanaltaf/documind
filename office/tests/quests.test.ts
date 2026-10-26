import { describe, expect, it } from "vitest";
import type { GameEvent } from "@/game/quests/bus";
import { CORE_QUEST_IDS, type Progress, type QuestContext, type QuestId, QUEST_IDS, QUESTS } from "@/game/quests/definitions";
import { applyEvent, coreStatus, emptyProgress, reconcile, rooftopUnlocked, unlocksOf } from "@/game/quests/engine";
import { mergeProgress, normalizeProgress, progressPatchSchema, saveProgressSchema, toPatch } from "@/game/quests/schema";

// Phase O9 › Tests: the quest engine over scripted event sequences, and the server-side merge.

const DEPARTMENTS = ["HR", "IT", "Finance", "Facilities"];
const OFFICES = ["san-francisco", "lahore", "berlin"];
const context = (patch: Partial<QuestContext> = {}): QuestContext => ({
  offices: OFFICES,
  locations: [...OFFICES, "worldwide"],
  departments: DEPARTMENTS,
  location: "lahore",
  now: "2026-10-25T10:00:00.000Z",
  ...patch,
});

const trivia = (correct: number): GameEvent => ({ type: "game_finished", game: "trivia", score: correct * 120, details: { correct, total: 10, location: "lahore" } });
const sortToss = (score: number): GameEvent => ({ type: "game_finished", game: "sort_toss", score, details: { correct: 10, wrong: 1, maxCombo: 6 } });
const tennis = (won: boolean, difficulty: 1 | 2 | 3): GameEvent => ({
  type: "game_finished",
  game: "table_tennis",
  score: 50,
  details: { won, pointsFor: won ? 7 : 3, pointsAgainst: won ? 2 : 7, difficulty },
});
const asked = (department: string | null, location = "lahore"): GameEvent => ({ type: "question_asked", npc: department ? `expert:${department}` : "reception", department, location });

/** Plays events one by one; returns the final progress and everything that completed or unlocked, in order. */
function play(events: GameEvent[], start: Progress = emptyProgress(), ctx: QuestContext = context()) {
  let progress = start;
  const completed: QuestId[] = [];
  const unlocked: string[] = [];
  for (const event of events) {
    const result = applyEvent(progress, event, ctx);
    progress = result.progress;
    completed.push(...result.completed);
    unlocked.push(...result.unlocked);
  }
  return { progress, completed, unlocked };
}

const CORE_RUN: GameEvent[] = [
  { type: "badge_issued", departments: ["HR", "IT", "Finance"] },
  { type: "presentation_watched", deck: "company", location: "lahore" },
  asked("HR"),
  asked("IT"),
  asked("Finance"),
  { type: "citation_opened", doc_code: "SIM-HR-101", department: "HR" },
  sortToss(120),
];

describe("core quests", () => {
  it("lists five core quests and seven side quests, each with a title and a hint", () => {
    expect(CORE_QUEST_IDS).toHaveLength(5);
    expect(QUESTS.filter((q) => q.kind === "side")).toHaveLength(7);
    expect(QUESTS.map((q) => q.id)).toEqual([...QUEST_IDS]);
    for (const quest of QUESTS) {
      expect(quest.title).not.toBe("");
      expect(quest.hint).not.toBe("");
    }
  });

  it("completes each core quest exactly once, in the order its event arrives", () => {
    const { progress, completed } = play(CORE_RUN);
    expect(completed).toEqual(["first_day", "orientation", "meet_experts", "check_source", "team_spirit"]);
    expect(CORE_QUEST_IDS.every((id) => progress.quests[id]?.done_at === "2026-10-25T10:00:00.000Z")).toBe(true);
    expect(coreStatus(progress)).toEqual({ done: 5, total: 5 });
  });

  it("Orientation is the company's deck, not DocuMind's own", () => {
    const own: GameEvent = { type: "presentation_watched", deck: "documind", location: "lahore" };
    expect(play([own]).completed).toEqual([]);
    expect(play([own, { ...own, deck: "company" }]).completed).toEqual(["orientation"]);
  });

  it("does not complete a quest without its event", () => {
    // Everything but the badge: First day stays open, and so does the lift.
    const { progress, completed } = play(CORE_RUN.slice(1));
    expect(completed).not.toContain("first_day");
    expect(progress.quests.first_day).toBeUndefined();
    expect(rooftopUnlocked(progress)).toBe(false);
    expect(coreStatus(progress)).toEqual({ done: 4, total: 5 });
  });

  it("is idempotent: replaying finished quests' events completes and unlocks nothing again", () => {
    const first = play(CORE_RUN);
    const second = play(CORE_RUN, first.progress);
    expect(second.completed).toEqual([]);
    expect(second.unlocked).toEqual([]);
    for (const id of CORE_QUEST_IDS) expect(second.progress.quests[id]).toEqual(first.progress.quests[id]);
  });

  it("keeps the first done_at when the same event comes back later", () => {
    const first = play([{ type: "badge_issued", departments: ["HR"] }]);
    const later = applyEvent(first.progress, { type: "badge_issued", departments: ["IT"] }, context({ now: "2026-11-01T00:00:00.000Z" }));
    expect(later.progress).toBe(first.progress);
    expect(later.progress.quests.first_day?.done_at).toBe("2026-10-25T10:00:00.000Z");
  });

  it("counts Meet the experts by distinct departments, and not reception questions", () => {
    const { progress, completed } = play([asked(null), asked("HR"), asked("HR"), asked("IT")]);
    expect(progress.quests.meet_experts).toEqual({ progress: 2 });
    expect(completed).toEqual([]);
    expect(play([asked("Finance")], progress).completed).toEqual(["meet_experts"]);
  });

  it("unlocks the rooftop only when all five core quests are done", () => {
    let progress = emptyProgress();
    for (const [index, event] of CORE_RUN.entries()) {
      progress = applyEvent(progress, event, context()).progress;
      const done = coreStatus(progress).done;
      expect(rooftopUnlocked(progress)).toBe(done === 5);
      expect(unlocksOf(progress)).toEqual(done === 5 ? ["rooftop"] : []);
      expect(index < CORE_RUN.length - 1 ? done < 5 : done === 5).toBe(true);
    }
  });

  it("keeps progress separate per org", () => {
    const orgA = play([{ type: "badge_issued", departments: ["HR"] }, asked("HR")]);
    const orgB = play([asked("IT")]);
    expect(orgA.progress.quests.first_day?.done_at).toBeDefined();
    expect(orgB.progress.quests.first_day).toBeUndefined();
    expect(orgB.progress.stats.asked_departments).toEqual(["IT"]);
    expect(orgA.progress.stats.asked_departments).toEqual(["HR"]);
  });
});

describe("side quests", () => {
  it("Globetrotter needs every office (the hub does not count)", () => {
    const events: GameEvent[] = [
      { type: "office_entered", location: "lahore" },
      { type: "office_entered", location: "lahore" },
      { type: "office_entered", location: "worldwide" },
      { type: "office_entered", location: "berlin" },
    ];
    const { progress, completed } = play(events);
    expect(progress.quests.globetrotter).toEqual({ progress: 2 });
    expect(completed).toEqual([]);
    expect(play([{ type: "office_entered", location: "san-francisco" }], progress).completed).toEqual(["globetrotter"]);
  });

  it("Local knowledge counts cities where a question was answered", () => {
    const { completed, progress } = play([asked("HR", "lahore"), asked(null, "berlin"), asked("IT", "berlin"), asked("IT", "worldwide")]);
    expect(completed).toEqual(["local_knowledge"]);
    expect(progress.stats.asked_cities).toEqual(["lahore", "berlin", "worldwide"]);
  });

  it("Department tour needs a room per department", () => {
    const rooms = DEPARTMENTS.map<GameEvent>((department) => ({ type: "room_entered", room: `dept:${department}`, department, location: "lahore" }));
    const lobby: GameEvent = { type: "room_entered", room: "lobby", location: "lahore" };
    const { completed, progress } = play([lobby, ...rooms.slice(0, 3)]);
    expect(completed).toEqual([]);
    expect(progress.quests.department_tour).toEqual({ progress: 3 });
    expect(play([rooms[3]], progress).completed).toEqual(["department_tour"]);
  });

  it("Bookworm counts every opened citation up to ten, and Check the source needs one", () => {
    const open: GameEvent = { type: "citation_opened", doc_code: null, department: null };
    const nine = play(Array.from({ length: 9 }, () => open));
    expect(nine.progress.quests.bookworm).toEqual({ progress: 9 });
    expect(nine.completed).toEqual(["check_source"]);
    expect(play([open], nine.progress).completed).toEqual(["bookworm"]);
  });

  it("Trivia ace needs 10 of 10 in one round", () => {
    expect(play([trivia(9)]).completed).toEqual(["team_spirit"]);
    expect(play([trivia(10)]).completed).toEqual(["team_spirit", "trivia_ace"]);
  });

  it("Clean desk needs a Sort & Toss score at the threshold", () => {
    expect(play([sortToss(299)]).completed).toEqual(["team_spirit"]);
    expect(play([sortToss(300)]).completed).toEqual(["team_spirit", "clean_desk"]);
  });

  it("Rally needs a table tennis win on level 3", () => {
    expect(play([tennis(true, 2), tennis(false, 3)]).completed).toEqual(["team_spirit"]);
    expect(play([tennis(true, 3)]).completed).toEqual(["team_spirit", "rally"]);
  });

  it("shrinks a target to what the org has (two departments, one office)", () => {
    const small = context({ departments: ["HR", "IT"], offices: ["lahore"], locations: ["lahore", "worldwide"] });
    const { completed } = play([asked("HR"), asked("IT"), { type: "office_entered", location: "lahore" }, asked(null, "worldwide")], emptyProgress(), small);
    expect(completed).toEqual(["meet_experts", "globetrotter", "local_knowledge"]);
  });
});

describe("achievements", () => {
  it("gives every quest an achievement and stamps it with the completion time", () => {
    const { progress, unlocked } = play(CORE_RUN);
    expect(unlocked).toEqual(CORE_QUEST_IDS.map((id) => `quest_${id}`));
    expect(progress.achievements.quest_first_day).toBe("2026-10-25T10:00:00.000Z");
  });

  it("Night owl and Early bird follow the city's local time, never the hub's", () => {
    const night: GameEvent = { type: "city_entered", location: "lahore", isNight: true, hour: 23.5 };
    const dawn: GameEvent = { type: "city_entered", location: "berlin", isNight: false, hour: 6.25 };
    const noon: GameEvent = { type: "city_entered", location: "paris", isNight: false, hour: 12 };
    const hub: GameEvent = { type: "city_entered", location: "worldwide", isNight: true, hour: 5 };
    expect(play([night]).unlocked).toEqual(["night_owl"]);
    expect(play([dawn]).unlocked).toEqual(["early_bird"]);
    expect(play([noon, hub]).unlocked).toEqual([]);
  });

  it("Social butterfly needs ten people, one per office each", () => {
    const talk = (npc: string): GameEvent => ({ type: "npc_talked", npc });
    const people = ["reception", "presenter", ...DEPARTMENTS.map((d) => `expert:${d}`)];
    const here = play([...people, ...people].map(talk));
    expect(here.progress.stats.npcs_met).toHaveLength(6);
    expect(here.unlocked).toEqual([]);
    const there = play(people.map(talk), here.progress, context({ location: "berlin" }));
    expect(there.progress.stats.npcs_met).toHaveLength(12);
    expect(there.unlocked).toEqual(["social_butterfly"]);
  });

  it("Rooftop is earned by arriving at the rooftop scene", () => {
    expect(play([{ type: "scene_entered", scene: "office" }]).unlocked).toEqual([]);
    expect(play([{ type: "scene_entered", scene: "rooftop" }]).unlocked).toEqual(["rooftop"]);
  });
});

describe("engine details", () => {
  it("returns the same progress object when an event changes nothing", () => {
    const progress = emptyProgress();
    expect(applyEvent(progress, { type: "emote_used", emote: "wave" as never }, context()).progress).toBe(progress);
  });

  it("does not mutate its input", () => {
    const before = emptyProgress();
    const frozen = JSON.stringify(before);
    applyEvent(before, { type: "badge_issued", departments: ["HR"] }, context());
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it("reconciles counters saved before quests existed", () => {
    const old: Progress = {
      ...emptyProgress(),
      stats: { citations_opened: 12, rooms_visited: ["lahore/lobby", "lahore/dept:HR", "berlin/dept:HR", "lahore/dept:IT", "lahore/dept:Finance", "lahore/dept:Facilities"] },
    };
    const { progress, completed } = reconcile(old, context());
    expect(completed.sort()).toEqual(["bookworm", "check_source", "department_tour"]);
    expect(progress.quests.bookworm?.done_at).toBeDefined();
    expect(reconcile(progress, context()).progress).toBe(progress);
  });
});

describe("saving progress", () => {
  const stored = normalizeProgress({
    quests: { first_day: { progress: 1, done_at: "2026-10-20T08:00:00.000Z" }, bookworm: { progress: 6 } },
    achievements: { quest_first_day: "2026-10-20T08:00:00.000Z" },
    stats: { asked_departments: ["HR"], citations_opened: 6 },
  });

  it("never lowers a counter and keeps the first done_at", () => {
    const merged = mergeProgress(stored, {
      quests: { first_day: { progress: 1, done_at: "2026-10-25T10:00:00.000Z" }, bookworm: { progress: 2 }, rally: { progress: 1, done_at: "2026-10-25T10:00:00.000Z" } },
      achievements: { quest_first_day: "2026-10-25T10:00:00.000Z", night_owl: "2026-10-25T10:00:00.000Z" },
    });
    expect(merged.quests.first_day).toEqual({ progress: 1, done_at: "2026-10-20T08:00:00.000Z" });
    expect(merged.quests.bookworm).toEqual({ progress: 6 });
    expect(merged.quests.rally).toEqual({ progress: 1, done_at: "2026-10-25T10:00:00.000Z" });
    expect(merged.achievements.quest_first_day).toBe("2026-10-20T08:00:00.000Z");
    expect(merged.achievements.night_owl).toBe("2026-10-25T10:00:00.000Z");
  });

  it("raises a counter and unions the stat sets, leaving the stats it does not own alone", () => {
    const merged = mergeProgress(stored, { quests: { bookworm: { progress: 8 } }, stats: { asked_departments: ["IT", "HR"], npcs_met: ["lahore:reception"] } });
    expect(merged.quests.bookworm).toEqual({ progress: 8 });
    expect(merged.stats.asked_departments).toEqual(["HR", "IT"]);
    expect(merged.stats.npcs_met).toEqual(["lahore:reception"]);
    expect(merged.stats.citations_opened).toBe(6);
  });

  it("is idempotent", () => {
    const patch = toPatch(play(CORE_RUN).progress);
    const once = mergeProgress(stored, patch);
    expect(mergeProgress(once, patch)).toEqual(once);
  });

  it("round-trips a patch through the schema", () => {
    const patch = toPatch(play(CORE_RUN).progress);
    expect(progressPatchSchema.safeParse(patch).success).toBe(true);
    expect(saveProgressSchema.safeParse({ orgId: "org-1", patch }).success).toBe(true);
  });

  it("rejects ids, shapes and sizes the game never produces", () => {
    const bad = (patch: unknown) => progressPatchSchema.safeParse(patch).success;
    expect(bad({ quests: { made_up: { progress: 1 } } })).toBe(false);
    expect(bad({ quests: { rally: { progress: -1 } } })).toBe(false);
    expect(bad({ quests: { rally: { progress: 1, done_at: "yesterday" } } })).toBe(false);
    expect(bad({ achievements: { superhero: "2026-10-25T10:00:00.000Z" } })).toBe(false);
    expect(bad({ stats: { citations_opened: 99 } })).toBe(false);
    expect(bad({ stats: { asked_cities: Array.from({ length: 101 }, (_, i) => `c${i}`) } })).toBe(false);
    expect(bad({ extra: true })).toBe(false);
  });

  it("drops what it does not recognise from a stored row", () => {
    const row = normalizeProgress({ quests: { first_day: "yes", nope: { progress: 1 }, rally: { progress: "3" } }, achievements: { ghost: "2026-10-25T10:00:00.000Z" }, stats: { asked_cities: ["x", 4] } });
    expect(row.quests).toEqual({});
    expect(row.achievements).toEqual({});
    expect(row.stats).toEqual({ asked_cities: ["x"] });
    expect(normalizeProgress(null)).toEqual(emptyProgress());
  });
});
