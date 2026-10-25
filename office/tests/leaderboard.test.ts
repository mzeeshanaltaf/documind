// Loads the root .env.local before the app's DB pool is imported (below, via the actions).
import { createTestUser, type TestUser } from "../e2e/support/test-user";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getLeaderboard, getLeaderboards, submitScore } from "@/app/(game)/actions";
import { requireOrgAccess } from "@/lib/auth-guards";
import { pool } from "@/lib/db";
import { recordScore, topScores } from "@/lib/leaderboard";

// Phase O8 › Tests: scores and leaderboards on the dev DB with throwaway users in a throwaway org
// (the guard is mocked, as in record-stats.test.ts): the best score per player, hidden players and
// people who aren't members left out, the week filter, ranks, bounds and the submit rate limit.

vi.mock("@/lib/auth-guards", () => ({ requireOrgAccess: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiJson: vi.fn() }));

// A DB round trip from this machine is ~0.45 s, and setup makes dozens.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.OFFICE_BETTER_AUTH_SECRET);

describe.skipIf(!hasDb)("scores and leaderboards", () => {
  const slug = `test-office-board-${crypto.randomBytes(4).toString("hex")}`;
  const orgId = `test-org-${slug}`;
  const users: Record<string, TestUser> = {};
  let anyUser: TestUser;

  const addPlayer = (user: TestUser, name: string, settings: Record<string, unknown> = {}) =>
    user.officeQuery(`insert into {office}.players (user_id, display_name, settings) values ($1, $2, $3::jsonb)`, [user.id, name, JSON.stringify(settings)]);
  const addScore = (user: TestUser, game: string, score: number, ago = "0 days") =>
    user.officeQuery(
      `insert into {office}.game_scores (user_id, org_id, game, score, details, created_at) values ($1, $2, $3, $4, '{}'::jsonb, now() - $5::interval)`,
      [user.id, orgId, game, score, ago],
    );

  beforeAll(async () => {
    await pool.query(`insert into organization (id, name, slug, "createdAt") values ($1, 'Board Test Org', $2, now())`, [orgId, slug]);
    users.alice = await createTestUser("Alice Anders", { orgs: [slug] });
    users.bob = await createTestUser("Bob Hidden", { orgs: [slug] });
    users.carol = await createTestUser("Carol Gone"); // played here, is not a member
    users.dora = await createTestUser("Dora Admin", { admin: true }); // a platform admin, not a member
    users.erin = await createTestUser("Erin Early", { orgs: [slug] });
    users.finn = await createTestUser("Finn Fresh", { orgs: [slug] });
    users.gail = await createTestUser("Gail Guard", { orgs: [slug] });
    anyUser = users.alice;

    await addPlayer(users.alice, "Alice A.");
    await addPlayer(users.bob, "Bob H.", { hide_from_leaderboard: true });
    await addPlayer(users.carol, "Carol G.");
    await addPlayer(users.dora, "Dora A.");
    await addPlayer(users.erin, "Erin E.");
    await addPlayer(users.finn, "Finn F.");
    await addPlayer(users.gail, "Gail G.");

    await addScore(users.alice, "trivia", 500);
    await addScore(users.alice, "trivia", 900);
    await addScore(users.alice, "sort_toss", 200);
    await addScore(users.bob, "trivia", 1500);
    await addScore(users.carol, "trivia", 1200);
    await addScore(users.dora, "trivia", 700);
    await addScore(users.erin, "trivia", 1000, "30 days");
    await addScore(users.erin, "trivia", 300);
  });

  afterAll(async () => {
    // The org's delete cascades its scores; each user's removal cascades the rest.
    await pool.query(`delete from member where "organizationId" = $1`, [orgId]);
    await pool.query(`delete from organization where id = $1`, [orgId]);
    for (const user of Object.values(users)) await user.remove();
    await pool.end();
  });

  const asMember = (user: TestUser) =>
    vi.mocked(requireOrgAccess).mockResolvedValue({
      user: { id: user.id } as never,
      org: { id: orgId, name: "Board Test Org", slug, logo: null },
      role: "member",
      isAdmin: false,
    });

  beforeEach(() => {
    vi.mocked(requireOrgAccess).mockReset();
  });

  it("lists each player's best score once, newest-first on ties, with the viewer marked", async () => {
    const boards = await topScores(orgId, users.alice.id, "all");
    expect(boards.trivia.map((e) => [e.rank, e.name, e.score])).toEqual([
      [1, "Erin E.", 1000],
      [2, "Alice A.", 900],
      [3, "Dora A.", 700],
    ]);
    expect(boards.trivia.map((e) => e.mine)).toEqual([false, true, false]);
    expect(boards.sort_toss.map((e) => [e.name, e.score])).toEqual([["Alice A.", 200]]);
    expect(boards.table_tennis).toEqual([]);
  });

  it("leaves out players who hide themselves and people who aren't members (admins stay)", async () => {
    const names = (await topScores(orgId, users.alice.id, "all")).trivia.map((e) => e.name);
    expect(names).not.toContain("Bob H.");
    expect(names).not.toContain("Carol G.");
    expect(names).toContain("Dora A.");
  });

  it("counts only the last seven days for 'week'", async () => {
    const week = (await topScores(orgId, users.erin.id, "week")).trivia;
    expect(week.map((e) => [e.name, e.score])).toEqual([
      ["Alice A.", 900],
      ["Dora A.", 700],
      ["Erin E.", 300],
    ]);
    expect(week.find((e) => e.name === "Erin E.")?.mine).toBe(true);
  });

  it("serves one game or all three through the actions, to members only", async () => {
    asMember(users.alice);
    const one = await getLeaderboard({ orgId, game: "trivia", period: "all" });
    expect(one.map((e) => e.name)).toEqual(["Erin E.", "Alice A.", "Dora A."]);
    const all = await getLeaderboards({ orgId, period: "all" });
    expect(Object.keys(all!)).toEqual(["trivia", "sort_toss", "table_tennis"]);
    expect(await getLeaderboard({ orgId, game: "chess" as never, period: "all" })).toEqual([]);
    expect(await getLeaderboards({ orgId, period: "month" as never })).toBeNull();
    // A non-member is turned away by the guard, which throws (notFound) in the real app.
    vi.mocked(requireOrgAccess).mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(getLeaderboard({ orgId, game: "trivia", period: "all" })).rejects.toThrow();
  });

  it("stores a score, returns its rank, and refuses a second submit within ten seconds", async () => {
    const input = { game: "trivia", score: 800, details: { correct: 6, total: 10, location: "lahore" } } as const;
    const first = await recordScore(users.finn.id, orgId, input);
    expect(first).toEqual({ ok: true, rank: 3, personalBest: true });
    const second = await recordScore(users.finn.id, orgId, { ...input, score: 850 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    const rows = await anyUser.officeQuery<{ n: string }>(`select count(*) as n from {office}.game_scores where user_id = $1`, [users.finn.id]);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("rejects out-of-bounds and inconsistent scores without storing them", async () => {
    asMember(users.gail);
    const count = async () => Number((await anyUser.officeQuery<{ n: string }>(`select count(*) as n from {office}.game_scores where user_id = $1`, [users.gail.id]))[0].n);

    const tooHigh = await submitScore({ orgId, game: "trivia", score: 99_999, details: { correct: 10, total: 10, location: "lahore" } });
    expect(tooHigh.ok).toBe(false);
    const cheat = await submitScore({ orgId, game: "table_tennis", score: 130, details: { won: false, pointsFor: 2, pointsAgainst: 7, difficulty: 3 } });
    expect(cheat.ok).toBe(false);
    const wrongShape = await submitScore({ orgId, game: "sort_toss", score: 10, details: { correct: 1 } } as never);
    expect(wrongShape.ok).toBe(false);
    const noOrg = await submitScore({ game: "trivia", score: 100, details: { correct: 1, total: 10, location: "lahore" } } as never);
    expect(noOrg).toMatchObject({ ok: false });
    expect(await count()).toBe(0);

    const fine = await submitScore({ orgId, game: "sort_toss", score: 120, details: { correct: 6, wrong: 1, maxCombo: 4 } });
    expect(fine).toMatchObject({ ok: true, personalBest: true });
    expect(await count()).toBe(1);

    // Straight away again: too fast (the Upstash limit when it's configured, else the database check).
    const again = await submitScore({ orgId, game: "sort_toss", score: 130, details: { correct: 6, wrong: 1, maxCombo: 4 } });
    expect(again).toMatchObject({ ok: false, error: "You're submitting scores too fast." });
    expect(await count()).toBe(1);
  });
});
