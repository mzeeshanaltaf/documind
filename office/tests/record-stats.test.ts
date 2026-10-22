// Loads the root .env.local before the app's DB pool is imported (below, via the actions).
import { createTestUser, type TestUser } from "../e2e/support/test-user";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordStats } from "@/app/(game)/actions";
import { requireOrgAccess } from "@/lib/auth-guards";
import { pool } from "@/lib/db";

// Phase O6 › Room visits: `recordStats` on the dev DB with a throwaway user (the guard is mocked,
// as in issue-cards.test.ts). Rooms merge as a set in first-visit order; counters only grow.

vi.mock("@/lib/auth-guards", () => ({ requireOrgAccess: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiJson: vi.fn() }));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.OFFICE_BETTER_AUTH_SECRET);

describe.skipIf(!hasDb)("recordStats", () => {
  let user: TestUser;
  let orgId: string;

  beforeAll(async () => {
    user = await createTestUser("Test Office Stats", { orgs: ["simtora"] });
    const [org] = await user.officeQuery<{ id: string }>(`select id from organization where slug = 'simtora'`);
    orgId = org.id;
  });

  afterAll(async () => {
    await user?.remove();
    await pool.end();
  });

  beforeEach(() => {
    vi.mocked(requireOrgAccess).mockReset();
    vi.mocked(requireOrgAccess).mockResolvedValue({
      user: { id: user.id } as never,
      org: { id: orgId, name: "Simtora Technologies", slug: "simtora", logo: null },
      role: "member",
      isAdmin: false,
    });
  });

  const stats = async () =>
    (await user.officeQuery<{ stats: Record<string, unknown> }>(`select stats from {office}.progress where user_id = $1 and org_id = $2`, [user.id, orgId]))[0]
      ?.stats ?? null;

  it("refuses a non-member, and ignores malformed or empty batches", async () => {
    vi.mocked(requireOrgAccess).mockRejectedValueOnce(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(recordStats(orgId, { rooms_visited: ["lahore/dept:HR"] })).rejects.toThrow("404");
    expect(await recordStats(orgId, { rooms_visited: ["no-slash"] })).toEqual({ ok: false });
    expect(await recordStats(orgId, { citations_opened: -1 })).toEqual({ ok: false });
    expect(await recordStats(orgId, {})).toEqual({ ok: true });
    expect(await stats()).toBeNull();
  });

  it("merges rooms as a set in first-visit order and adds citations, keeping other stats", async () => {
    await user.officeQuery(
      `insert into {office}.progress (user_id, org_id, stats) values ($1, $2, '{"cities_visited": ["lahore"]}'::jsonb)`,
      [user.id, orgId],
    );
    expect(await recordStats(orgId, { rooms_visited: ["lahore/lobby", "lahore/dept:HR", "lahore/lobby"] })).toEqual({ ok: true });
    expect(await recordStats(orgId, { rooms_visited: ["lahore/dept:HR", "berlin/dept:HR"], citations_opened: 2 })).toEqual({ ok: true });
    expect(await recordStats(orgId, { citations_opened: 1 })).toEqual({ ok: true });
    expect(await stats()).toEqual({
      cities_visited: ["lahore"],
      rooms_visited: ["lahore/lobby", "lahore/dept:HR", "berlin/dept:HR"],
      citations_opened: 3,
    });
  });
});
