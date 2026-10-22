// Loads the root .env.local before the app's DB pool is imported (below, via the actions).
import { createTestUser, type TestUser } from "../e2e/support/test-user";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCards } from "@/app/(game)/actions";
import { apiJson } from "@/lib/api";
import { requireOrgAccess } from "@/lib/auth-guards";
import { pool } from "@/lib/db";

// Phase O5 › Tests: `issueCards` on the dev DB with a throwaway user. The access guard and
// DocuMind's document list are mocked (the guard's own SQL is covered by the O3 browser tests:
// a non-member gets not found); the merge into `progress.cards` is real SQL.

vi.mock("@/lib/auth-guards", () => ({ requireOrgAccess: vi.fn(), requireSession: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiJson: vi.fn() }));

const DOCUMENTS = ["HR", "HR", "IT", "Finance", "Corporate"].map((department, index) => ({
  id: `doc-${index}`,
  department,
  indexed_at: "2026-10-01T00:00:00Z",
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.OFFICE_BETTER_AUTH_SECRET);

describe.skipIf(!hasDb)("issueCards", () => {
  let user: TestUser;
  let orgId: string;

  beforeAll(async () => {
    user = await createTestUser("Test Office Cards", { orgs: ["simtora"] });
    const [org] = await user.officeQuery<{ id: string }>(`select id from organization where slug = 'simtora'`);
    orgId = org.id;
  });

  afterAll(async () => {
    await user?.remove();
    await pool.end();
  });

  beforeEach(() => {
    vi.mocked(requireOrgAccess).mockReset();
    vi.mocked(apiJson).mockReset();
    vi.mocked(apiJson).mockResolvedValue({ documents: DOCUMENTS });
  });

  const held = async () =>
    (await user.officeQuery<{ cards: string[] }>(`select cards from {office}.progress where user_id = $1 and org_id = $2`, [user.id, orgId]))[0]?.cards ?? null;

  const asMember = () =>
    vi.mocked(requireOrgAccess).mockResolvedValue({
      user: { id: user.id } as never,
      org: { id: orgId, name: "Simtora Technologies", slug: "simtora", logo: null },
      role: "member",
      isAdmin: false,
    });

  it("refuses a non-member before reading or writing anything", async () => {
    vi.mocked(requireOrgAccess).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(issueCards(orgId, ["HR"])).rejects.toThrow("404");
    expect(apiJson).not.toHaveBeenCalled();
    expect(await held()).toBeNull();
  });

  it("rejects departments without a room (unknown, Corporate) and empty picks", async () => {
    asMember();
    expect(await issueCards(orgId, ["HR", "Legal"])).toEqual({ ok: false, error: "There's no Legal room in this office." });
    expect(await issueCards(orgId, ["Corporate"])).toMatchObject({ ok: false });
    expect(await issueCards(orgId, [])).toMatchObject({ ok: false });
    expect(await held()).toBeNull();
  });

  it("merges into progress.cards idempotently, in room order", async () => {
    asMember();
    expect(await issueCards(orgId, ["IT"])).toEqual({ ok: true, cards: ["IT"] });
    expect(await issueCards(orgId, ["HR", "IT", "HR"])).toEqual({ ok: true, cards: ["HR", "IT"] });
    expect(await issueCards(orgId, ["IT", "HR"])).toEqual({ ok: true, cards: ["HR", "IT"] });
    expect(await issueCards(orgId, ["Finance"])).toEqual({ ok: true, cards: ["HR", "IT", "Finance"] });
    expect((await held())?.toSorted()).toEqual(["Finance", "HR", "IT"]);
    expect(vi.mocked(apiJson).mock.calls[0]).toEqual([`orgs/${orgId}/documents`, { userId: user.id }]);
  });
});
