import type { GameEvent } from "./bus";

/**
 * Quests and their progress shapes (phase O9). Pure data and pure functions: the engine
 * (`engine.ts`) walks `QUESTS` for every bus event, the journal renders them, the server stores
 * `Progress` (`progress.quests`, `.achievements`, `.stats` as jsonb) and the rooftop lift reads
 * the core quests. A quest is done when its progress reaches its target.
 */

export const CORE_QUEST_IDS = ["first_day", "orientation", "meet_experts", "check_source", "team_spirit"] as const;
export const SIDE_QUEST_IDS = ["globetrotter", "local_knowledge", "department_tour", "bookworm", "trivia_ace", "clean_desk", "rally"] as const;
export const QUEST_IDS = [...CORE_QUEST_IDS, ...SIDE_QUEST_IDS] as const;
export type QuestId = (typeof QUEST_IDS)[number];

export const EXTRA_ACHIEVEMENT_IDS = ["night_owl", "early_bird", "social_butterfly", "rooftop"] as const;
export type AchievementId = `quest_${QuestId}` | (typeof EXTRA_ACHIEVEMENT_IDS)[number];

export const isQuestId = (value: unknown): value is QuestId => QUEST_IDS.includes(value as QuestId);

export type QuestState = { progress: number; done_at?: string };

/**
 * Stats the engine keeps. The five sets are written by the engine (and merged by union on the
 * server); `citations_opened`, `rooms_visited` and `cities_visited` belong to `recordStats` and
 * `recordVisit` (O3, O6): the engine reads them and never saves them.
 */
export type Stats = {
  asked_departments?: string[];
  asked_cities?: string[];
  offices_entered?: string[];
  departments_entered?: string[];
  /** `{location}:{npc}`: a person counts once per office. */
  npcs_met?: string[];
  citations_opened?: number;
  rooms_visited?: string[];
  cities_visited?: string[];
};
export const ENGINE_SETS = ["asked_departments", "asked_cities", "offices_entered", "departments_entered", "npcs_met"] as const;
export type EngineSet = (typeof ENGINE_SETS)[number];

export type Progress = {
  quests: Partial<Record<QuestId, QuestState>>;
  achievements: Partial<Record<AchievementId, string>>;
  stats: Stats;
};

/** What a quest needs to know about the org it is played in. */
export type QuestContext = {
  /** The org's office locations (not the Worldwide hub). */
  offices: string[];
  /** Offices plus the hub: every place a question can be asked. */
  locations: string[];
  /** Departments that have a room. */
  departments: string[];
  /** The location the player is in now (events that don't carry one). */
  location: string | null;
  /** ISO time, stamped on completions. */
  now: string;
};

/** A table tennis match counts for "Rally" on the hardest level (`difficulty` 3). */
export const HARDEST_LEVEL = 3;
/** "Clean desk": a Sort & Toss round at or above this score (the best possible is about 1,100). */
export const CLEAN_DESK_SCORE = 300;
export const SOCIAL_TARGET = 10;
/** "Early bird": a local arrival from 04:00 up to (not including) 08:00. */
export const EARLY_BIRD_HOURS = { from: 4, to: 8 } as const;

export type QuestDef = {
  id: QuestId;
  title: string;
  description: string;
  kind: "core" | "side";
  /** Where to go, in the journal's words. */
  hint: string;
  target: (context: QuestContext) => number;
  /**
   * The progress after `event`, given stats that already include it; `undefined` when the event
   * is not this quest's business.
   */
  advance: (event: GameEvent, stats: Stats, context: QuestContext) => number | undefined;
  /** Progress that the stored stats alone prove (counters saved before quests existed). */
  fromStats?: (stats: Stats, context: QuestContext) => number;
};

const count = (list: string[] | undefined, allowed?: string[]) => (list ?? []).filter((item) => !allowed || allowed.includes(item)).length;
const upTo = (limit: number, available: number) => Math.max(1, Math.min(limit, available));

export const QUESTS: readonly QuestDef[] = [
  {
    id: "first_day",
    title: "First day",
    description: "Get your access badge at Reception.",
    kind: "core",
    hint: "Reception is left of the entrance, in the lobby. Ask for a card.",
    target: () => 1,
    advance: (event) => (event.type === "badge_issued" ? 1 : undefined),
  },
  {
    id: "orientation",
    title: "Orientation",
    description: "Watch the full company presentation.",
    kind: "core",
    hint: "The presentation room is the glass door on the left of the lobby. Take a seat and let every slide play.",
    target: () => 1,
    // Both decks of the loop end in `presentation_watched`; the quest is about the company's.
    advance: (event) => (event.type === "presentation_watched" && event.deck === "company" ? 1 : undefined),
  },
  {
    id: "meet_experts",
    title: "Meet the experts",
    description: "Ask questions in 3 different department rooms.",
    kind: "core",
    hint: "Use your card on a department door along the corridor, then ask the expert inside.",
    target: (context) => upTo(3, context.departments.length),
    advance: (event, stats, context) =>
      event.type === "question_asked" && event.department ? count(stats.asked_departments, context.departments) : undefined,
  },
  {
    id: "check_source",
    title: "Check the source",
    description: "Open a citation.",
    kind: "core",
    hint: "Ask an expert a question, then click a citation under the answer to open the PDF at that page.",
    target: () => 1,
    advance: (event) => (event.type === "citation_opened" ? 1 : undefined),
    fromStats: (stats) => ((stats.citations_opened ?? 0) > 0 ? 1 : 0),
  },
  {
    id: "team_spirit",
    title: "Team spirit",
    description: "Finish any game in the play area.",
    kind: "core",
    hint: "The play area is the room on the right of the lobby. Play Policy Trivia, Sort & Toss or table tennis to the end.",
    target: () => 1,
    advance: (event) => (event.type === "game_finished" ? 1 : undefined),
  },
  {
    id: "globetrotter",
    title: "Globetrotter",
    description: "Enter every office of the company.",
    kind: "side",
    hint: "Travel from the Global Hub's kiosks, or pick another office from the map in the menu.",
    target: (context) => Math.max(1, context.offices.length),
    advance: (event, stats, context) => (event.type === "office_entered" ? count(stats.offices_entered, context.offices) : undefined),
  },
  {
    id: "local_knowledge",
    title: "Local knowledge",
    description: "Ask a question in 3 different cities.",
    kind: "side",
    hint: "Questions asked at Reception or to any expert count, one city at a time.",
    target: (context) => upTo(3, context.locations.length),
    advance: (event, stats, context) => (event.type === "question_asked" ? count(stats.asked_cities, context.locations) : undefined),
  },
  {
    id: "department_tour",
    title: "Department tour",
    description: "Enter every department room.",
    kind: "side",
    hint: "One card per department. Reception prints as many as you like.",
    target: (context) => Math.max(1, context.departments.length),
    advance: (event, stats, context) => (event.type === "room_entered" && event.department ? count(stats.departments_entered, context.departments) : undefined),
    fromStats: (stats, context) => {
      // `rooms_visited` entries are `{location}/{room}`, a department room being `dept:HR`.
      const rooms = (stats.rooms_visited ?? []).map((visit) => visit.split("/")[1] ?? "");
      const seen = rooms.filter((room) => room.startsWith("dept:")).map((room) => room.slice("dept:".length));
      return count([...new Set(seen)], context.departments);
    },
  },
  {
    id: "bookworm",
    title: "Bookworm",
    description: "Open 10 citations.",
    kind: "side",
    hint: "Every citation chip or sources row you open counts, in the rooms and after a game.",
    target: () => 10,
    advance: (event, stats) => (event.type === "citation_opened" ? Math.min(10, stats.citations_opened ?? 0) : undefined),
    fromStats: (stats) => Math.min(10, stats.citations_opened ?? 0),
  },
  {
    id: "trivia_ace",
    title: "Trivia ace",
    description: "Answer all 10 questions right in one Policy Trivia round.",
    kind: "side",
    hint: "Policy Trivia is in the play area. The answers are in the policy PDFs.",
    target: () => 1,
    advance: (event) =>
      event.type === "game_finished" && event.game === "trivia" && "total" in event.details && event.details.correct === event.details.total ? 1 : undefined,
  },
  {
    id: "clean_desk",
    title: "Clean desk",
    description: `Score ${CLEAN_DESK_SCORE} or more in Sort & Toss.`,
    kind: "side",
    hint: "Sort & Toss is in the play area: build a streak of right bins for the multiplier.",
    target: () => 1,
    advance: (event) => (event.type === "game_finished" && event.game === "sort_toss" && event.score >= CLEAN_DESK_SCORE ? 1 : undefined),
  },
  {
    id: "rally",
    title: "Rally",
    description: "Beat the CPU at table tennis on the hardest level.",
    kind: "side",
    hint: "The table is in the play area. Pick level 3 and win the match.",
    target: () => 1,
    advance: (event) =>
      event.type === "game_finished" && event.game === "table_tennis" && "won" in event.details && event.details.won && event.details.difficulty === HARDEST_LEVEL ? 1 : undefined,
  },
];

export const QUEST_BY_ID: Readonly<Record<QuestId, QuestDef>> = Object.fromEntries(QUESTS.map((quest) => [quest.id, quest])) as Record<QuestId, QuestDef>;

export type AchievementDef = { id: AchievementId; title: string; description: string; kind: "quest" | "special" };

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  ...QUESTS.map<AchievementDef>((quest) => ({ id: `quest_${quest.id}`, title: quest.title, description: quest.description, kind: "quest" })),
  { id: "night_owl", title: "Night owl", description: "Arrive at an office after dark, by its local time.", kind: "special" },
  { id: "early_bird", title: "Early bird", description: "Arrive at an office between 04:00 and 08:00, by its local time.", kind: "special" },
  { id: "social_butterfly", title: "Social butterfly", description: `Talk to ${SOCIAL_TARGET} people around the offices.`, kind: "special" },
  { id: "rooftop", title: "Rooftop", description: "Reach the rooftop lounge.", kind: "special" },
];

export const ACHIEVEMENT_BY_ID: Readonly<Record<AchievementId, AchievementDef>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a])) as Record<AchievementId, AchievementDef>;
