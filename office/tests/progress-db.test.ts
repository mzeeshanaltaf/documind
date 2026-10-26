// Loads the root .env.local before the app's DB pool is imported (below, via the actions).
import { createTestUser, type TestUser } from "../e2e/support/test-user";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProgress, saveProgress } from "@/app/(game)/actions";
import { requireOrgAccess } from "@/lib/auth-guards";
import { pool } from "@/lib/db";
import { readProgress } from "@/lib/progress";

// Phase O9 › Tests: the server-side merge on the dev DB, with throwaway users in two throwaway
// orgs (the guard is mocked, as in leaderboard.test.ts): counters never decrease, done_at is set
// once, saves from two tabs both land, progress is separate per org, and the stats that
// recordStats owns survive a save.

vi.mock("@/lib/auth-guards", () => ({ requireOrgAccess: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiJson: vi.fn() }));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.OFFICE_BETTER_AUTH_SECRET);

describe.skipIf(!hasDb)("saving quest progress", () => {
  const suffix = crypto.randomBytes(4).toString("hex");
  const slugs = [`test-office-quests-a-${suffix}`, `test-office-quests-b-${suffix}`];
  const orgIds = slugs.map((slug) => `test-org-${slug}`);
  let user: TestUser;
  let outsider: TestUser;

  const asMember = (orgId: string, who: TestUser = user) =>
    vi.mocked(requireOrgAccess).mockResolvedValue({
      user: { id: who.id } as never,
      org: { id: orgId, name: "Quest Test Org", slug: orgId, logo: null },
      role: "member",
      isAdmin: false,
    });

  beforeAll(async () => {
    for (const [index, slug] of slugs.entries()) {
      await pool.query(`insert into organization (id, name, slug, "createdAt") values ($1, 'Quest Test Org', $2, now())`, [orgIds[index], slug]);
    }
    user = await createTestUser("Quinn Quester", { orgs: slugs });
    outsider = await createTestUser("Olive Outsider");
  });

  afterAll(async () => {
    await pool.query(`delete from member where "organizationId" = any($1::text[])`, [orgIds]);
    await pool.query(`delete from organization where id = any($1::text[])`, [orgIds]);
    await user.remove();
    await outsider.remove();
    await pool.end();
  });

  beforeEach(() => {
    vi.mocked(requireOrgAccess).mockReset();
  });

  it("starts empty", async () => {
    asMember(orgIds[0]);
    expect(await loadProgress(orgIds[0])).toEqual({ quests: {}, achievements: {}, stats: {} });
  });

  it("stores a save and reads it back after a reload", async () => {
    asMember(orgIds[0]);
    const done = "2026-10-25T10:00:00.000Z";
    const saved = await saveProgress(orgIds[0], {
      quests: { first_day: { progress: 1, done_at: done }, bookworm: { progress: 4 } },
      achievements: { quest_first_day: done },
      stats: { asked_departments: ["HR"], npcs_met: ["lahore:reception"] },
    });
    expect(saved).toEqual({ ok: true });
    const loaded = await loadProgress(orgIds[0]);
    expect(loaded.quests).toEqual({ first_day: { progress: 1, done_at: done }, bookworm: { progress: 4 } });
    expect(loaded.achievements).toEqual({ quest_first_day: done });
    expect(loaded.stats).toEqual({ asked_departments: ["HR"], npcs_met: ["lahore:reception"] });
  });

  it("never lowers a counter and keeps the first done_at", async () => {
    asMember(orgIds[0]);
    await saveProgress(orgIds[0], {
      quests: { first_day: { progress: 1, done_at: "2030-01-01T00:00:00.000Z" }, bookworm: { progress: 2 }, rally: { progress: 1, done_at: "2026-10-26T00:00:00.000Z" } },
      achievements: { quest_first_day: "2030-01-01T00:00:00.000Z" },
      stats: { asked_departments: ["IT", "HR"] },
    });
    const loaded = await loadProgress(orgIds[0]);
    expect(loaded.quests.first_day).toEqual({ progress: 1, done_at: "2026-10-25T10:00:00.000Z" });
    expect(loaded.quests.bookworm).toEqual({ progress: 4 });
    expect(loaded.quests.rally).toEqual({ progress: 1, done_at: "2026-10-26T00:00:00.000Z" });
    expect(loaded.achievements.quest_first_day).toBe("2026-10-25T10:00:00.000Z");
    expect(loaded.stats.asked_departments).toEqual(["HR", "IT"]);
  });

  it("keeps both of two saves made at once", async () => {
    asMember(orgIds[0]);
    await Promise.all([
      saveProgress(orgIds[0], { quests: { bookworm: { progress: 7 } }, stats: { asked_cities: ["lahore"] } }),
      saveProgress(orgIds[0], { quests: { globetrotter: { progress: 2 } }, stats: { asked_cities: ["berlin"] } }),
    ]);
    const loaded = await loadProgress(orgIds[0]);
    expect(loaded.quests.bookworm?.progress).toBe(7);
    expect(loaded.quests.globetrotter?.progress).toBe(2);
    expect([...(loaded.stats.asked_cities ?? [])].sort()).toEqual(["berlin", "lahore"]);
  });

  it("leaves the stats that recordStats owns alone", async () => {
    asMember(orgIds[0]);
    await user.officeQuery(
      `update {office}.progress set stats = stats || '{"citations_opened": 6, "rooms_visited": ["lahore/lobby"], "cities_visited": ["lahore"]}'::jsonb where user_id = $1 and org_id = $2`,
      [user.id, orgIds[0]],
    );
    await saveProgress(orgIds[0], { stats: { npcs_met: ["lahore:presenter"] } });
    const loaded = await loadProgress(orgIds[0]);
    expect(loaded.stats.citations_opened).toBe(6);
    expect(loaded.stats.rooms_visited).toEqual(["lahore/lobby"]);
    expect(loaded.stats.cities_visited).toEqual(["lahore"]);
    expect(loaded.stats.npcs_met).toEqual(["lahore:reception", "lahore:presenter"]);
  });

  it("keeps each org's progress separate", async () => {
    asMember(orgIds[1]);
    expect(await loadProgress(orgIds[1])).toEqual({ quests: {}, achievements: {}, stats: {} });
    await saveProgress(orgIds[1], { quests: { orientation: { progress: 1, done_at: "2026-10-27T00:00:00.000Z" } } });
    const other = await readProgress(user.id, orgIds[1]);
    expect(Object.keys(other.quests)).toEqual(["orientation"]);
    const first = await readProgress(user.id, orgIds[0]);
    expect(first.quests.orientation).toBeUndefined();
  });

  it("refuses a patch the game never sends, and stores nothing", async () => {
    asMember(orgIds[0]);
    const before = await readProgress(user.id, orgIds[0]);
    const bad = await saveProgress(orgIds[0], { quests: { made_up: { progress: 1 } } } as never);
    expect(bad).toEqual({ ok: false });
    const tooMany = await saveProgress(orgIds[0], { stats: { asked_cities: Array.from({ length: 101 }, (_, i) => `c${i}`) } });
    expect(tooMany).toEqual({ ok: false });
    expect(await readProgress(user.id, orgIds[0])).toEqual(before);
  });

  it("turns away someone who isn't a member (the guard throws)", async () => {
    vi.mocked(requireOrgAccess).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(saveProgress(orgIds[0], { quests: { rally: { progress: 1 } } })).rejects.toThrow();
    await expect(loadProgress(orgIds[0])).rejects.toThrow();
    expect((await readProgress(outsider.id, orgIds[0])).quests).toEqual({});
  });
});
