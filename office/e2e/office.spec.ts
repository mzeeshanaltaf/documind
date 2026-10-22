import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O5 › Tests (Playwright): a non-admin Simtora member in Lahore, on the dev DB.
//   1. The real flow: the security door is locked; Reception prints every card; the receptionist
//      answers a real question (one billed DocuMind chat), the quota meter goes down by one; the
//      door now opens onto the corridor.
//   2. Refusals with the network mocked (no LLM spend): the rate-limit countdown, a used-up
//      quota, and changed files (documents refetched, the question retried once).
test.describe.configure({ mode: "serial" });

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Test Office Lobby", { orgs: ["simtora"] });
  // A saved look, so the first-visit avatar editor stays shut.
  await user.officeQuery(
    `insert into {office}.players (user_id, display_name, avatar) values ($1, 'Test L.', '{"top": "#2f6f5e"}'::jsonb)
     on conflict (user_id) do update set avatar = excluded.avatar`,
    [user.id],
  );
});

test.afterAll(async () => {
  await user?.remove();
});

async function signIn(context: BrowserContext) {
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

type Snapshot = {
  scene: string;
  phase: string;
  position: [number, number, number];
  room: string | null;
  focus: { id: string; locked: boolean; reason?: string } | null;
  modal: string | null;
  cards: string[];
};

function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const s = window.__office?.getState();
    if (!s) return null;
    return {
      scene: s.world.scene,
      phase: s.world.phase,
      position: s.player.position,
      room: s.world.location.room,
      focus: s.focus,
      modal: s.modal?.type ?? null,
      cards: s.player.cards,
    };
  });
}

async function waitReady(page: Page, scene: string) {
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      return s ? `${s.scene}:${s.phase}` : "booting";
    }, { timeout: 120_000 })
    .toBe(`${scene}:ready`);
}

/** Lahore's street, then straight into the lobby at the entrance spawn. */
async function enterLobby(page: Page, spawn: { position: [number, number, number]; yaw: number } = { position: [0, 0, 3.4], yaw: Math.PI }) {
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");
  await page.evaluate((s) => window.__office!.getState().transitionTo("office", s), spawn);
  await waitReady(page, "office");
  // Camera behind the avatar facing north, so the arrows map to the compass.
  await page.evaluate(() => {
    window.__office!.rig.yaw = 0;
  });
}

/** Holds a key until `done` holds for the snapshot (or fails after `timeout`). */
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
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { messages_used: number }).messages_used;
}

test("locked door, cards at Reception, a real answer, the quota, then the corridor", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 800, height: 450 });
  await signIn(context);
  await enterLobby(page);
  expect((await snapshot(page))?.room).toBe("Lobby");
  await expect(page.locator('[data-quota="messages"]')).toHaveText("0 of 25 messages");
  // Under the 300 draw-call budget on medium (shadows on: the worst case, see O4).
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));
  await page.waitForTimeout(1200);
  const calls = (await page.evaluate(() => window.__office!.render()))!.calls;
  console.log("Lobby draw calls (medium):", calls);
  expect(calls).toBeLessThan(300);
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));

  // 1. Walk north to the security door: locked, and it stays shut.
  await holdUntil(page, "ArrowUp", (s) => s.focus?.id === "door:security");
  let s = (await snapshot(page))!;
  expect(s.focus).toMatchObject({ locked: true, reason: "You need an access card · Visit Reception" });
  await expect(page.getByRole("button", { name: /Department wing, locked/ })).toBeVisible();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ArrowUp");
  s = (await snapshot(page))!;
  expect(s.position[2]).toBeGreaterThan(-7);
  expect(s.room).toBe("Lobby");

  // 2. Back a little, then west to the receptionist; E opens her menu; take every card.
  await holdUntil(page, "ArrowDown", (snap) => snap.position[2] > -5.4);
  await holdUntil(page, "ArrowLeft", (snap) => snap.focus?.id === "npc:reception");
  await page.keyboard.press("e");
  const dialog = page.locator("[data-npc-dialogue]");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Sara Malik" })).toBeVisible();
  await expect(dialog).toContainText("Welcome to Simtora Lahore!");
  await dialog.getByRole("button", { name: /Get access cards/ }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(7);
  await dialog.getByRole("button", { name: "Take all" }).click();
  await expect(dialog.getByRole("status")).toContainText("Here are your 7 cards.");
  await expect.poll(async () => (await snapshot(page))?.cards.length).toBe(7);
  const [row] = await user.officeQuery<{ cards: string[] }>(
    `select p.cards from {office}.progress p join organization o on o.id = p.org_id where p.user_id = $1 and o.slug = 'simtora'`,
    [user.id],
  );
  expect(row.cards.toSorted()).toEqual(["Compliance", "Facilities", "Finance", "HR", "IT", "International", "Procurement"]);
  // (The HUD is outside the open dialog, so it's hidden from the accessibility tree for now.)
  await expect(page.locator("section[aria-label='Access cards'] [aria-label$=' card']")).toHaveCount(7);
  await dialog.getByRole("button", { name: "Done" }).click();

  // 3. Ask a real question: it streams, a conversation exists, the quota goes down by one.
  const before = await quotaUsed(page);
  await dialog.getByRole("button", { name: /Ask a question/ }).click();
  await expect(dialog).toContainText("Answers from 10 Lahore documents");
  const composer = dialog.getByRole("textbox", { name: "Your question" });
  await expect(composer).toBeFocused();
  // Movement keys typed into the composer never move the avatar.
  const still = (await snapshot(page))!.position;
  await composer.pressSequentially("wasd");
  await page.waitForTimeout(400);
  expect((await snapshot(page))!.position).toEqual(still);
  await composer.fill("How many days of annual leave do I get in Pakistan?");
  await composer.press("Enter");
  await expect(dialog.getByText(/Looking up policies|Reading \d+ sources|Answering/)).toBeVisible();
  const turn = () =>
    page.evaluate(() => {
      const state = window.__office!.getState();
      const thread = state.chat["lahore:reception"];
      const last = thread?.turns.at(-1);
      return last
        ? { status: last.status, conversationId: thread.conversationId, codes: last.sources.map((x) => x.jurisdiction), content: last.content }
        : null;
    });
  await expect.poll(async () => (await turn())?.status, { timeout: 120_000 }).toBe("complete");
  const answer = (await turn())!;
  expect(answer.conversationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(answer.content.length).toBeGreaterThan(20);
  // Lahore reception cites only PK, GLOBAL or base-manual (US) documents.
  for (const jurisdiction of answer.codes) expect(["PK", "GLOBAL", "US"]).toContain(jurisdiction);
  await expect(dialog.getByRole("link", { name: /Continue in DocuMind/ })).toHaveAttribute(
    "href",
    new RegExp(`/app/simtora/chat/${answer.conversationId}$`),
  );
  await expect.poll(() => quotaUsed(page), { timeout: 15_000 }).toBe(before + 1);
  await expect(page.locator('[data-quota="messages"]')).toHaveText(`${before + 1} of 25 messages`, { timeout: 15_000 });

  // Esc closes the dialogue and movement resumes.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await snapshot(page))?.modal).toBeNull();

  // 4. With a card the security door opens onto the corridor.
  await page.evaluate(() => {
    window.__office!.rig.yaw = 0;
  });
  await holdUntil(page, "ArrowRight", (snap) => snap.position[0] > -0.3);
  await holdUntil(page, "ArrowUp", (snap) => snap.position[2] < -8.5);
  expect((await snapshot(page))?.room).toBe("Corridor");
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Corridor");
});

/** OFFICE_SHOTS=<dir>: screenshots of the lobby, the corridor, the minimap and the dialogue views. */
test("screenshots (OFFICE_SHOTS)", async ({ page, context }) => {
  const shots = process.env.OFFICE_SHOTS;
  test.skip(!shots, "set OFFICE_SHOTS to a directory");
  test.setTimeout(240_000);
  fs.mkdirSync(shots!, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: path.join(shots!, `office-${name}.png`) });
  await signIn(context);
  await enterLobby(page);
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));
  const look = async (yaw: number, pitch: number, distance: number) => {
    await page.evaluate(
      ([y, p, d]) => {
        Object.assign(window.__office!.rig, { yaw: y, pitch: p, distance: d });
      },
      [yaw, pitch, distance] as const,
    );
    await page.waitForTimeout(1800);
  };
  await look(0, 0.5, 5.5);
  await shot("lobby-entrance");
  await look(Math.PI * 0.8, 0.5, 8);
  await shot("lobby-reverse");
  await page.keyboard.press("m");
  await page.waitForTimeout(400);
  await shot("minimap-large");
  await page.keyboard.press("m");

  await page.evaluate(() => window.__office!.getState().setCards(["HR", "IT"]));
  await page.evaluate(() => window.__office!.getState().transitionTo("office", { position: [0, 0, -12], yaw: Math.PI }));
  await waitReady(page, "office");
  await look(0.35, 0.5, 6);
  await shot("corridor");

  await page.evaluate(() => window.__office!.getState().transitionTo("office", { position: [-2.6, 0, -0.8], yaw: Math.PI }));
  await waitReady(page, "office");
  await page.evaluate(() => window.__office!.getState().startDialogue({ type: "npc", npc: "reception", view: "menu" }, [-4.2, 1.5, -3.45]));
  await page.waitForTimeout(1800);
  await shot("dialogue-menu");
  await page.evaluate(() => window.__office!.getState().setNpcView("cards"));
  await page.waitForTimeout(500);
  await shot("dialogue-cards");
  await page.route("**/api/backend/orgs/*/chat", (route) =>
    route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: RECORDED }),
  );
  await page.evaluate(() => window.__office!.getState().setNpcView("chat"));
  await page.waitForTimeout(500);
  await shot("dialogue-chat-empty");
  const composer = page.locator("[data-npc-dialogue]").getByRole("textbox", { name: "Your question" });
  await composer.fill("How many days of annual leave do I get in Pakistan?");
  await composer.press("Enter");
  await page.waitForTimeout(2500);
  await shot("dialogue-chat-answer");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(500);
  await shot("dialogue-chat-answer-dark");
});

const RECORDED = fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "chat-answer.sse"), "utf8");

test("refusals: rate-limit countdown, a used-up quota, and changed files", async ({ page, context }) => {
  test.setTimeout(240_000);
  await signIn(context);
  // Next to the receptionist, in the chat view.
  await enterLobby(page, { position: [-2.6, 0, -0.8], yaw: Math.PI });
  const openChat = () =>
    page.evaluate(() => window.__office!.getState().startDialogue({ type: "npc", npc: "reception", view: "chat" }, [-4.2, 1.5, -3.45]));
  await openChat();
  const dialog = page.locator("[data-npc-dialogue]");
  const composer = dialog.getByRole("textbox", { name: "Your question" });
  const ask = async (question: string) => {
    await composer.fill(question);
    await composer.press("Enter");
  };

  // Rate limited: the NPC asks for a moment, and the composer counts down.
  await page.route("**/api/backend/orgs/*/chat", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "4", "Content-Type": "application/json" },
      body: JSON.stringify({ error: { code: "rate_limited", message: "Slow down." } }),
    }),
  );
  await ask("What's the limit for a business dinner?");
  await expect(dialog).toContainText("One moment, give me 4s.");
  await expect(dialog.getByText(/Ask again in [1-4]s\./)).toBeVisible();
  await expect(composer).toBeDisabled();
  await expect(composer).toBeEnabled({ timeout: 8000 });
  await page.unroute("**/api/backend/orgs/*/chat");

  // Changed files: 422 once → the documents are fetched again and the question is retried.
  let posts = 0;
  let documentFetches = 0;
  await page.route("**/api/backend/orgs/*/documents", async (route) => {
    documentFetches += 1;
    await route.continue();
  });
  await page.route("**/api/backend/orgs/*/chat", (route) => {
    posts += 1;
    if (posts === 1) {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "unknown_documents", message: "Unknown documents.", details: { document_ids: ["x"] } } }),
      });
    }
    return route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: RECORDED });
  });
  await ask("How many days of annual leave do I get in Pakistan?");
  await expect(dialog).toContainText("My files just changed. One second.");
  await expect.poll(() => page.evaluate(() => window.__office!.getState().chat["lahore:reception"]?.turns.at(-1)?.status)).toBe("complete");
  expect(posts).toBe(2);
  expect(documentFetches).toBe(1);
  // The retried question isn't shown twice.
  await expect(dialog.getByText("How many days of annual leave do I get in Pakistan?", { exact: true })).toHaveCount(1);
  await page.unroute("**/api/backend/orgs/*/chat");

  // Quota used up: the meter turns red, the NPC declines politely, the composer is disabled.
  await page.route("**/api/backend/me/quota", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user_id: user.id,
        message_limit: 0,
        token_limit: 100000,
        messages_used: 0,
        tokens_used: 0,
        period_start: "2026-10-01",
        resets_on: "2026-11-01",
        is_custom: true,
        unlimited: false,
        exhausted: "messages",
      }),
    }),
  );
  await page.route("**/api/backend/orgs/*/chat", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "quota_exceeded", message: "Monthly quota reached.", details: { resets_on: "2026-11-01" } } }),
    }),
  );
  await page.keyboard.press("Escape");
  await openChat();
  await expect(page.locator("[data-quota-level]")).toHaveAttribute("data-quota-level", "exhausted", { timeout: 15_000 });
  await expect(dialog).toContainText("You've used this month's questions. They renew on 1 Nov.");
  await expect(composer).toBeDisabled();
  await expect(dialog).toContainText("You've reached this month's quota.");
});

test("a quota of 0 set in DocuMind: the real API refuses, the NPC declines, the composer is disabled", async ({ page, context }) => {
  test.setTimeout(180_000);
  // What DocuMind's /admin/users writes for a custom limit (the row cascades with the user).
  await user.officeQuery(
    `insert into user_quotas (user_id, message_limit, token_limit, updated_at) values ($1, 0, 100000, now())
     on conflict (user_id) do update set message_limit = 0`,
    [user.id],
  );
  try {
    await signIn(context);
    await enterLobby(page, { position: [-2.6, 0, -0.8], yaw: Math.PI });
    const quota = (await (await page.request.get("/api/backend/me/quota")).json()) as { exhausted: string | null; resets_on: string };
    expect(quota.exhausted).toBe("messages");
    // DocuMind itself refuses before any LLM call.
    const orgId = await page.evaluate(() => window.__office!.getState().office!.org.id);
    const refused = await page.request.post(`/api/backend/orgs/${orgId}/chat`, { data: { message: "Hello?" } });
    expect(refused.status()).toBe(429);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("quota_exceeded");

    await page.evaluate(() => window.__office!.getState().startDialogue({ type: "npc", npc: "reception", view: "chat" }, [-4.2, 1.5, -3.45]));
    const dialog = page.locator("[data-npc-dialogue]");
    await expect(dialog).toContainText("You've used this month's questions. They renew on");
    await expect(dialog.getByRole("textbox", { name: "Your question" })).toBeDisabled();
    await expect(page.locator("[data-quota-level]")).toHaveAttribute("data-quota-level", "exhausted");
  } finally {
    await user.officeQuery(`delete from user_quotas where user_id = $1`, [user.id]);
  }
});
