import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O6 › Tests (Playwright): a non-admin Simtora member holding every card, on the dev DB.
//   1. Lahore: walk into HR, ask the expert a real question (one billed DocuMind chat): the
//      routed documents are inside the Lahore HR scope, the citations are Lahore's or global, a
//      chip opens the PDF sheet on the cited page with the passage marked, and reopening it
//      doesn't fetch the PDF again. The quota goes down by one; the visit is recorded.
//   2. Berlin: the same question cites Germany's supplement or the global one (billed).
//   3. Worldwide HR: the country chips re-scope a new conversation (mocked chat, no spend).
//   4. OFFICE_SHOTS=<dir>: a screenshot of every room, the dialogue with the PDF open, the chips.
test.describe.configure({ mode: "serial" });

const CARDS = ["Compliance", "Facilities", "Finance", "HR", "IT", "International", "Procurement"];
const RECORDED = fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "chat-answer.sse"), "utf8");

// Simtora's floor plan (buildFloorplan with its 7 departments): HR is the first bay, west side,
// x -9.6…-1.6, z -15…-7; its door is at (-1.6, -11) and its expert stands at (-8, -9.8).
const HR_EXPERT: [number, number, number] = [-8, 1.5, -9.8];

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Test Office Rooms", { orgs: ["simtora"] });
  await user.officeQuery(
    `insert into {office}.players (user_id, display_name, avatar) values ($1, 'Test R.', '{"top": "#2c3e63"}'::jsonb)
     on conflict (user_id) do update set avatar = excluded.avatar`,
    [user.id],
  );
  await user.officeQuery(
    `insert into {office}.progress (user_id, org_id, cards)
     select $1, id, $2::text[] from organization where slug = 'simtora'
     on conflict (user_id, org_id) do update set cards = excluded.cards`,
    [user.id, CARDS],
  );
});

test.afterAll(async () => {
  await user?.remove();
});

async function signIn(context: BrowserContext) {
  await context.addCookies([{ name: SESSION_COOKIE, value: user.cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

type Snapshot = { scene: string; phase: string; position: [number, number, number]; room: string | null; focus: string | null; modal: string | null };

function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const s = window.__office?.getState();
    if (!s) return null;
    return { scene: s.world.scene, phase: s.world.phase, position: s.player.position, room: s.world.location.room, focus: s.focus?.id ?? null, modal: s.modal?.type ?? null };
  });
}

async function waitReady(page: Page, scene: string) {
  await expect.poll(async () => {
    const s = await snapshot(page);
    return s ? `${s.scene}:${s.phase}` : "booting";
  }, { timeout: 120_000 }).toBe(`${scene}:ready`);
}

/** The location's street, then straight into the office at `spawn`. */
async function enterOffice(page: Page, location: string, spawn: { position: [number, number, number]; yaw: number }) {
  await page.goto(`/simtora/${location}`);
  await waitReady(page, "city");
  await page.evaluate((s) => window.__office!.getState().transitionTo("office", s), spawn);
  await waitReady(page, "office");
  await page.evaluate(() => {
    window.__office!.rig.yaw = 0;
  });
}

async function holdUntil(page: Page, key: string, done: (s: Snapshot) => boolean, timeout = 20_000) {
  await page.keyboard.down(key);
  try {
    await expect.poll(async () => done((await snapshot(page))!), { timeout, intervals: [100] }).toBe(true);
  } finally {
    await page.keyboard.up(key);
  }
}

async function quotaUsed(page: Page): Promise<number> {
  const response = await page.request.get("/api/backend/me/quota");
  return ((await response.json()) as { messages_used: number }).messages_used;
}

type Turn = { status: string; routingIds: string[]; cited: { n: number; code: string | null; page: number | null; documentId: string }[] };

function lastTurn(page: Page, key: string): Promise<Turn | null> {
  return page.evaluate((k) => {
    const last = window.__office!.getState().chat[k]?.turns.at(-1);
    if (!last) return null;
    return {
      status: last.status,
      routingIds: last.routing?.document_ids ?? [],
      cited: last.citations.map((c) => ({ n: c.n, code: c.doc_code, page: c.page_start, documentId: c.document_id })),
    };
  }, key);
}

/** The ids of these document codes in the org's list (from the game store). */
function idsOf(page: Page, docCodes: string[]): Promise<string[]> {
  return page.evaluate((wanted) => window.__office!.getState().office!.documents.filter((d) => wanted.includes(d.doc_code ?? "")).map((d) => d.id), docCodes);
}

async function ask(page: Page, question: string) {
  const composer = page.locator("[data-npc-dialogue]").getByRole("textbox", { name: "Your question" });
  await composer.fill(question);
  await composer.press("Enter");
}

test("Lahore HR: walk in, a real answer scoped to Lahore, citation → PDF page with the passage marked", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(context);
  const files: string[] = [];
  page.on("request", (request) => {
    const match = /\/documents\/([^/]+)\/file/.exec(request.url());
    if (match) files.push(match[1]);
  });

  // In the corridor facing the HR door; walk west through it to the expert.
  await enterOffice(page, "lahore", { position: [0, 0, -11], yaw: -Math.PI / 2 });
  await expect(page.locator('[data-quota="messages"]')).toBeVisible();
  const before = await quotaUsed(page);
  await holdUntil(page, "ArrowLeft", (s) => s.focus === "npc:expert:HR");
  expect((await snapshot(page))?.room).toBe("HR");
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("HR");
  // Inside a furnished room on medium (shadows on, the worst case): under the 300 draw-call budget.
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));
  await page.waitForTimeout(1500);
  const calls = (await page.evaluate(() => window.__office!.render()))!.calls;
  console.log("HR room draw calls (medium):", calls);
  expect(calls).toBeLessThan(300);
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));

  await page.keyboard.press("e");
  const dialog = page.locator("[data-npc-dialogue]");
  await expect(dialog.getByRole("heading", { name: "Hina Raza" })).toBeVisible();
  await expect(dialog).toContainText("Hi, I'm Hina, I look after People & HR for the Lahore team.");
  await expect(dialog).toContainText("HR · Lahore · 3 documents");
  await expect(dialog.getByRole("radiogroup", { name: "Country" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "How many days of annual leave do I get in Pakistan?" })).toBeVisible();

  await ask(page, "How many days of annual leave do I get?");
  await expect.poll(async () => (await lastTurn(page, "lahore:expert:HR"))?.status, { timeout: 120_000 }).toBe("complete");
  const turn = (await lastTurn(page, "lahore:expert:HR"))!;
  const scope = await idsOf(page, ["SIM-HR-001", "SIM-HR-002", "SIM-HR-101"]);
  expect(scope).toHaveLength(3);
  expect(turn.routingIds.length).toBeGreaterThan(0);
  for (const id of turn.routingIds) expect(scope).toContain(id);
  const codes = turn.cited.map((c) => c.code);
  console.log("Lahore HR cited:", codes.join(", "));
  expect(codes.length).toBeGreaterThan(0);
  for (const code of codes) expect(["SIM-HR-101", "SIM-HR-002", "SIM-HR-001"]).toContain(code);
  expect(codes.some((code) => code === "SIM-HR-101" || code === "SIM-HR-002")).toBe(true);
  await expect.poll(() => quotaUsed(page), { timeout: 15_000 }).toBe(before + 1);
  await expect(dialog.getByRole("button", { name: /^\d+ sources?$/ })).toBeVisible();

  // A chip opens the sheet at the cited page, with the passage marked.
  const chip = dialog.locator("[data-citation]").first();
  const n = Number(await chip.getAttribute("data-citation"));
  const cited = turn.cited.find((c) => c.n === n)!;
  await chip.click();
  const sheet = page.locator("[data-pdf-viewer]");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(cited.code ?? "");
  await expect(sheet.locator(".pdf-page")).toHaveAttribute("data-page", String(cited.page), { timeout: 60_000 });
  await expect(sheet.locator(".textLayer mark").first()).toBeAttached({ timeout: 60_000 });
  const marks = await sheet.locator(".textLayer mark").count();
  console.log(`${cited.code} p. ${cited.page}: ${marks} marked items`);
  expect(marks).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__office!.getState().viewer.request?.npc)).toBe("expert:HR");

  // Esc closes the sheet only; the same document again is not fetched again.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(dialog).toBeVisible();
  const fetches = files.filter((id) => id === cited.documentId).length;
  expect(fetches).toBe(1);
  const again = dialog.locator("[data-citation]").filter({ hasText: new RegExp(`^${n}$`) }).last();
  await again.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".textLayer mark").first()).toBeAttached({ timeout: 30_000 });
  expect(files.filter((id) => id === cited.documentId).length).toBe(1);
  await page.keyboard.press("Escape");

  // The room visit is saved (debounced, batched).
  await expect
    .poll(async () => {
      const [row] = await user.officeQuery<{ stats: { rooms_visited?: string[]; citations_opened?: number } }>(
        `select p.stats from {office}.progress p join organization o on o.id = p.org_id where p.user_id = $1 and o.slug = 'simtora'`,
        [user.id],
      );
      return row?.stats ?? {};
    }, { timeout: 15_000 })
    .toMatchObject({ rooms_visited: expect.arrayContaining(["lahore/dept:HR"]), citations_opened: 2 });
});

test("Berlin HR: the same question cites Germany's supplement or the global one", async ({ page, context }) => {
  test.setTimeout(240_000);
  await signIn(context);
  await enterOffice(page, "berlin", { position: [-6.6, 0, -9.8], yaw: -Math.PI / 2 });
  await page.evaluate((focus) => window.__office!.getState().startDialogue({ type: "npc", npc: "expert:HR", view: "chat" }, focus), HR_EXPERT);
  const dialog = page.locator("[data-npc-dialogue]");
  await expect(dialog.getByRole("heading", { name: "Katrin Weber" })).toBeVisible();
  await expect(dialog).toContainText("HR · Berlin · 3 documents");
  await ask(page, "How many days of annual leave do I get?");
  await expect.poll(async () => (await lastTurn(page, "berlin:expert:HR"))?.status, { timeout: 120_000 }).toBe("complete");
  const turn = (await lastTurn(page, "berlin:expert:HR"))!;
  const scope = await idsOf(page, ["SIM-HR-001", "SIM-HR-002", "SIM-HR-102"]);
  for (const id of turn.routingIds) expect(scope).toContain(id);
  const codes = turn.cited.map((c) => c.code);
  console.log("Berlin HR cited:", codes.join(", "));
  for (const code of codes) expect(["SIM-HR-102", "SIM-HR-002", "SIM-HR-001"]).toContain(code);
  expect(codes.some((code) => code === "SIM-HR-102" || code === "SIM-HR-002")).toBe(true);
});

test("Worldwide HR: a country chip starts a new conversation with that country's scope", async ({ page, context }) => {
  test.setTimeout(180_000);
  await signIn(context);
  const bodies: { conversation_id?: string | null; document_ids?: string[] }[] = [];
  await page.route("**/api/backend/orgs/*/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: RECORDED });
  });
  await enterOffice(page, "worldwide", { position: [-6.6, 0, -9.8], yaw: -Math.PI / 2 });
  await page.evaluate((focus) => window.__office!.getState().startDialogue({ type: "npc", npc: "expert:HR", view: "chat" }, focus), HR_EXPERT);
  const dialog = page.locator("[data-npc-dialogue]");
  await expect(dialog.getByRole("heading", { name: "Sofia Alvarez" })).toBeVisible();
  const chips = dialog.getByRole("radiogroup", { name: "Country" }).getByRole("radio");
  await expect(chips).toHaveText(["All", "PK", "DE", "FR", "AU", "GB", "US"]);
  await expect(chips.first()).toHaveAttribute("aria-checked", "true");
  await expect(dialog).toContainText("HR · Global Hub · 7 documents");

  await ask(page, "How many days of annual leave do I get?");
  await expect.poll(async () => (await lastTurn(page, "worldwide:expert:HR"))?.status).toBe("complete");
  expect(bodies[0].document_ids).toHaveLength(7);

  // A conversation is in progress, so a new country asks first; "Keep this one" changes nothing.
  await dialog.getByRole("radio", { name: "FR" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Start a new conversation for France?");
  await dialog.getByRole("button", { name: "Keep this one" }).click();
  await expect(dialog.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");

  await dialog.getByRole("radio", { name: "DE" }).click();
  await dialog.getByRole("button", { name: "Start new" }).click();
  await expect(dialog.getByRole("radio", { name: "DE" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog).toContainText("HR · Germany · 3 documents");
  expect(await lastTurn(page, "worldwide:expert:HR")).toBeNull();
  await expect(dialog.getByRole("button", { name: "How many days of annual leave do I get in Germany?" })).toBeVisible();

  await ask(page, "How many days of annual leave do I get?");
  await expect.poll(async () => (await lastTurn(page, "worldwide:expert:HR"))?.status).toBe("complete");
  const germany = await idsOf(page, ["SIM-HR-001", "SIM-HR-002", "SIM-HR-102"]);
  expect(bodies[1].conversation_id ?? null).toBeNull();
  expect(bodies[1].document_ids?.toSorted()).toEqual(germany.toSorted());
});

/** OFFICE_SHOTS=<dir>: every Lahore room, the dialogue with the PDF open, and the Worldwide chips. */
test("screenshots (OFFICE_SHOTS)", async ({ page, context }) => {
  const shots = process.env.OFFICE_SHOTS;
  test.skip(!shots, "set OFFICE_SHOTS to a directory");
  test.setTimeout(600_000);
  fs.mkdirSync(shots!, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  const shot = (name: string) => page.screenshot({ path: path.join(shots!, `room-${name}.png`) });
  await signIn(context);
  await page.route("**/api/backend/orgs/*/chat", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: RECORDED }),
  );
  await enterOffice(page, "lahore", { position: [0, 0, -11], yaw: -Math.PI / 2 });
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));

  const rooms = ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International"];
  for (const [index, department] of rooms.entries()) {
    const west = index % 2 === 0;
    const centre = -11 - Math.floor(index / 2) * 8;
    // Near the middle of the room facing the far wall; the camera high over the door side, so
    // the far wall (screen, desk, expert) and the north wall's decor are in view. West rooms are
    // the east ones turned half round (floorplan.roomFrame).
    const x = west ? -5.1 : 5.1;
    const z = west ? centre - 0.6 : centre + 0.6;
    await page.evaluate(([px, pz, yaw]) => window.__office!.getState().transitionTo("office", { position: [px, 0, pz], yaw }), [x, z, west ? -Math.PI / 2 : Math.PI / 2] as const);
    await waitReady(page, "office");
    await page.evaluate((yaw) => Object.assign(window.__office!.rig, { yaw, pitch: 0.85, distance: 7.5 }), west ? 2.07 : -1.07);
    await page.waitForTimeout(2500);
    await shot(department.toLowerCase());
  }

  // HR: the expert's answer, then a citation open in the sheet (the screen shows it).
  await page.evaluate(() => window.__office!.getState().transitionTo("office", { position: [-6.4, 0, -10.6], yaw: -Math.PI / 2 }));
  await waitReady(page, "office");
  await page.evaluate((focus) => window.__office!.getState().startDialogue({ type: "npc", npc: "expert:HR", view: "chat" }, focus), HR_EXPERT);
  await page.waitForTimeout(1500);
  await shot("hr-dialogue");
  await ask(page, "How many days of annual leave do I get?");
  await expect.poll(async () => (await lastTurn(page, "lahore:expert:HR"))?.status).toBe("complete");
  await page.waitForTimeout(800);
  await shot("hr-answer");
  await page.locator("[data-npc-dialogue] [data-citation]").first().click();
  await expect(page.locator("[data-pdf-viewer] .textLayer mark").first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await shot("hr-pdf");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(600);
  await shot("hr-pdf-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.goto("/simtora/worldwide");
  await waitReady(page, "city");
  await page.evaluate(() => window.__office!.getState().transitionTo("office", { position: [-6.6, 0, -9.8], yaw: -Math.PI / 2 }));
  await waitReady(page, "office");
  await page.evaluate((focus) => window.__office!.getState().startDialogue({ type: "npc", npc: "expert:HR", view: "chat" }, focus), HR_EXPERT);
  await page.waitForTimeout(1500);
  await shot("worldwide-hr-chips");
});
