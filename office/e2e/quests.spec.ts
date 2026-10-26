import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import bank from "../src/content/orgs/simtora-trivia.json";
import { buildFloorplan } from "../src/game/world/office/floorplan";
import { rooftopLayout } from "../src/game/world/office/rooftop-layout";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O9 › Tests (Playwright): a fresh non-admin Simtora member in Lahore, on the dev DB. Chat is
// mocked (a recorded answer), so nothing is billed.
//   1. A fresh player sees the coach marks and an empty journal; dismissing them is stored.
//   2. The five core quests, by their real events: Reception's cards (First day), the auditorium
//      (Orientation), three experts (Meet the experts), a Policy Trivia round with its source
//      (Team spirit, Check the source). Each toasts once; the others stay open until their own
//      event; "Show me" lays a guide; everything is in the database and survives a reload.
//   3. The lift unlocks, the rooftop loads: lift, telescope, wall of fame, fireworks.
//   OFFICE_SHOTS=<dir>: screenshots of the journal, the toasts, the rooftop by day and at night.
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.OFFICE_SHOTS;
const RECORDED = fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "chat-answer.sse"), "utf8");
const DEPARTMENTS = ["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International"];
const plan = buildFloorplan(DEPARTMENTS);
const roof = rooftopLayout();
// The presentation room's front-row seat (see presentation.spec.ts).
const IN_FRONT_OF_SEAT: [number, number, number] = [-17.3, 0, -2.45];
const PROGRAMME = 16;

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Test Office Quests", { orgs: ["simtora"] });
  await user.officeQuery(
    `insert into {office}.players (user_id, display_name, avatar) values ($1, 'Test Q.', '{"top": "#2c3e63"}'::jsonb)
     on conflict (user_id) do update set avatar = excluded.avatar`,
    [user.id],
  );
});

test.afterAll(async () => {
  await user?.remove();
});

async function signIn(context: BrowserContext) {
  await context.addCookies([{ name: SESSION_COOKIE, value: user.cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
}

type Snapshot = { scene: string; phase: string; room: string | null; focus: string | null; modal: string | null; unlocks: string[]; done: string[]; guide: string | null };

function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const s = window.__office?.getState();
    if (!s) return null;
    return {
      scene: s.world.scene,
      phase: s.world.phase,
      room: s.world.location.room,
      focus: s.focus?.id ?? null,
      modal: s.modal?.type ?? null,
      unlocks: s.unlocks,
      done: Object.entries(s.progress.quests).flatMap(([id, state]) => (state?.done_at ? [id] : [])),
      guide: s.guide?.quest ?? null,
    };
  });
}

async function waitReady(page: Page, scene: string) {
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return s ? `${s.scene}:${s.phase}` : "booting";
      },
      { timeout: 120_000 },
    )
    .toBe(`${scene}:ready`);
}

/** Moves to `position` in `scene` without reloading. */
async function goTo(page: Page, scene: "office" | "rooftop", position: [number, number, number], yaw = 0) {
  await page.evaluate(([s, p, y]) => window.__office!.getState().transitionTo(s as "office", { position: p as [number, number, number], yaw: y as number }), [scene, position, yaw] as const);
  await waitReady(page, scene);
}

const stored = () =>
  user.officeQuery<{ quests: Record<string, { progress: number; done_at?: string }>; achievements: Record<string, string> }>(
    `select p.quests, p.achievements from {office}.progress p join organization o on o.id = p.org_id where p.user_id = $1 and o.slug = 'simtora'`,
    [user.id],
  );
const doneInDb = async () => Object.entries((await stored())[0]?.quests ?? {}).flatMap(([id, state]) => (state.done_at ? [id] : [])).sort();
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `quests-${name}.png`) });
};

async function ask(page: Page, question: string) {
  const composer = page.locator("[data-npc-dialogue]").getByRole("textbox", { name: "Your question" });
  await composer.fill(question);
  await composer.press("Enter");
}

test("a fresh player: coach marks, an empty journal, then the five core quests one by one", async ({ page, context }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(context);
  await page.route("**/api/backend/orgs/*/chat", (route) => route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: RECORDED }));
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));

  // 1. The coach marks: three steps, then gone for good (stored in the player's settings).
  const coach = page.locator("section[data-coach]");
  await expect(coach).toBeVisible();
  await expect(coach).toHaveAttribute("data-coach", "0");
  await expect(coach).toContainText("Move");
  await shot(page, "coach");
  await coach.getByRole("button", { name: "Next" }).click();
  await expect(coach).toHaveAttribute("data-coach", "1");
  await coach.getByRole("button", { name: "Next" }).click();
  await expect(coach).toHaveAttribute("data-coach", "2");
  await expect(coach).toContainText("Journal");
  await coach.getByRole("button", { name: "Got it" }).click();
  await expect(coach).toHaveCount(0);
  await expect
    .poll(async () => (await user.officeQuery<{ done: boolean | null }>(`select (settings ->> 'coach_done')::boolean as done from {office}.players where user_id = $1`, [user.id]))[0]?.done, { timeout: 15_000 })
    .toBe(true);

  // An empty journal: J opens it, five core quests and seven side quests, none done.
  await page.keyboard.press("j");
  const journal = page.locator("[data-slot='dialog-content']");
  await expect(journal).toBeVisible();
  await expect(journal.locator("[data-rooftop]")).toHaveAttribute("data-rooftop", "locked");
  await expect(journal).toContainText("Rooftop unlocks at 0 of 5");
  await expect(journal.locator("[data-quest]")).toHaveCount(12);
  await expect(journal.locator("[data-quest][data-done='true']")).toHaveCount(0);
  await shot(page, "journal-empty");
  await journal.getByRole("tab", { name: /Achievements/ }).click();
  await expect(journal.locator("[data-achievement]")).toHaveCount(16);
  // (Night owl or Early bird may already be earned: arriving at Lahore's real local time counts.)
  await expect(journal.locator("[data-achievement^='quest_'][data-unlocked='true']")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(journal).toBeHidden();

  // 2. First day: Reception prints the cards. Only that quest completes, and it toasts.
  const [reception] = [plan.npcSpots.reception.position];
  await goTo(page, "office", [reception[0], 0, reception[2] + 2.1], Math.PI);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("npc:reception");
  await page.keyboard.press("e");
  const dialog = page.locator("[data-npc-dialogue]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Get access cards/ }).click();
  await dialog.getByRole("button", { name: "Take all" }).click();
  await expect(dialog.getByRole("status")).toContainText("Here are your 7 cards.");
  await expect.poll(async () => (await snapshot(page))?.done).toEqual(["first_day"]);
  await expect(page.locator("[data-toast='quest']")).toContainText("First day");
  await shot(page, "toast-first-day");
  // A question at Reception counts for a city but for no department.
  await dialog.getByRole("button", { name: "Done" }).click();
  await dialog.getByRole("button", { name: /Ask a question/ }).click();
  await ask(page, "How many days of annual leave do I get?");
  await expect.poll(() => page.evaluate(() => window.__office!.getState().chat["lahore:reception"]?.turns.at(-1)?.status), { timeout: 60_000 }).toBe("complete");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await snapshot(page))?.done).toEqual(["first_day"]);
  await expect.poll(doneInDb, { timeout: 15_000 }).toEqual(["first_day"]);

  // "Show me": a guide to the next expert, on the minimap; it ends on arrival.
  await page.keyboard.press("j");
  await expect(journal).toBeVisible();
  await journal.locator("[data-quest='meet_experts']").getByRole("button", { name: "Show me" }).click();
  await expect(journal).toBeHidden();
  expect((await snapshot(page))?.guide).toBe("meet_experts");
  await page.keyboard.press("m");
  await expect(page.locator("figure[aria-label='Office map'] [data-guide='meet_experts']")).toBeVisible();
  await page.keyboard.press("m");
  await shot(page, "guide");

  // 3. Orientation: sit in the auditorium and page through the whole programme.
  await goTo(page, "office", IN_FRONT_OF_SEAT);
  await expect.poll(async () => (await snapshot(page))?.focus).toBe("seat:1-3");
  await page.keyboard.press("e");
  await page.evaluate(() => window.__office!.getState().showSlide(0));
  for (let i = 0; i < PROGRAMME; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
  }
  await expect.poll(async () => (await snapshot(page))?.done.includes("orientation"), { timeout: 20_000 }).toBe(true);
  await page.keyboard.press("e");

  // 4. Meet the experts: a (mocked) answer in HR, IT and Finance. Two don't finish it.
  const askExpert = async (department: string) => {
    const spot = plan.npcSpots[`expert:${department}`];
    const west = plan.rooms.find((room) => room.department === department)?.side === "west";
    await goTo(page, "office", [spot.position[0] + (west ? 1.6 : -1.6), 0, spot.position[2] - 0.8], west ? -Math.PI / 2 : Math.PI / 2);
    await page.evaluate(([npc, focus]) => window.__office!.getState().startDialogue({ type: "npc", npc: npc as string, view: "chat" }, focus as [number, number, number]), [`expert:${department}`, spot.position] as const);
    await expect(dialog).toBeVisible();
    await ask(page, "How many days of annual leave do I get?");
    await expect.poll(() => page.evaluate((key) => window.__office!.getState().chat[key]?.turns.at(-1)?.status, `lahore:expert:${department}`), { timeout: 60_000 }).toBe("complete");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  };
  await askExpert("HR");
  await askExpert("IT");
  expect((await snapshot(page))?.done).not.toContain("meet_experts");
  await askExpert("Finance");
  await expect.poll(async () => (await snapshot(page))?.done.includes("meet_experts")).toBe(true);
  // Still no source, no game: the last two core quests are not done by anything else.
  expect((await snapshot(page))?.done).not.toContain("check_source");
  expect((await snapshot(page))?.done).not.toContain("team_spirit");

  // 5. A Policy Trivia round with its source: Team spirit and Check the source.
  const trivia = plan.rooms.find((room) => room.kind === "play")!;
  await goTo(page, "office", [trivia.rect.x + 1, 0, trivia.rect.z]);
  await page.evaluate(() => window.__office!.getState().startGame("trivia", [0, 0, 0]));
  const game = page.locator('[data-game-dialog="trivia"]');
  await expect(game).toBeVisible();
  await game.getByRole("button", { name: /^Start/ }).click();
  for (let i = 0; i < 10; i++) {
    const id = (await game.locator("[data-trivia-question]").getAttribute("data-trivia-question"))!;
    const question = bank.find((q) => q.id === id)!;
    // Each choice reads "<position><text>" (a number badge, then the text): "1" + "5 minutes" is not "3" + "15 minutes".
    const texts = (await game.locator("[data-choice]").allTextContents()).map((text) => text.trim());
    const right = texts.findIndex((text, position) => text === `${position + 1}${question.choices[question.answer]}`);
    expect(right, id).toBeGreaterThanOrEqual(0);
    await game.locator("[data-choice]").nth(right).click();
    await expect(game.locator("[data-trivia-review]")).toBeVisible();
    if (i === 2) {
      await game.getByRole("button", { name: "Show source" }).click();
      await expect(page.locator("[data-pdf-viewer]")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-pdf-viewer]")).toBeHidden();
    }
    await game.locator("[data-trivia-next]").click();
  }
  await expect(page.locator("[data-game-result]")).toBeVisible();
  await expect.poll(async () => (await snapshot(page))?.unlocks, { timeout: 15_000 }).toEqual(["rooftop"]);
  // A perfect round also earns the side quest for it, and one citation isn't Bookworm.
  const done = (await snapshot(page))!.done;
  expect(done).toEqual(expect.arrayContaining(["first_day", "orientation", "meet_experts", "check_source", "team_spirit", "trivia_ace"]));
  expect(done).not.toContain("bookworm");
  expect(done).not.toContain("rally");
  await expect.poll(doneInDb, { timeout: 15_000 }).toEqual(expect.arrayContaining(["first_day", "orientation", "meet_experts", "check_source", "team_spirit", "trivia_ace"]));
  await page.keyboard.press("Escape");
});

test("the five core quests survive a reload, the lift opens, and the rooftop is there", async ({ page, context }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await signIn(context);
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));

  // Loaded from the database: no coach marks, everything done stays done, nothing toasts again.
  await expect(page.locator("section[data-coach]")).toHaveCount(0);
  const s = (await snapshot(page))!;
  expect(s.unlocks).toEqual(["rooftop"]);
  expect(s.done).toEqual(expect.arrayContaining(["first_day", "orientation", "meet_experts", "check_source", "team_spirit"]));
  await expect(page.locator("[data-toast]")).toHaveCount(0);
  await page.keyboard.press("j");
  const journal = page.locator("[data-slot='dialog-content']");
  await expect(journal).toContainText("Rooftop unlocked");
  await expect(journal.locator("[data-quest][data-done='true']")).not.toHaveCount(0);
  await shot(page, "journal-core-done");
  await page.keyboard.press("Escape");

  // The lift at the corridor's end offers the ride.
  await goTo(page, "office", plan.spawns.lift.position, 0);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("door:lift");
  expect(await page.evaluate(() => window.__office!.getState().focus)).toMatchObject({ locked: false, label: "Take the lift to the rooftop" });
  await page.keyboard.press("e");
  await waitReady(page, "rooftop");
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Rooftop");
  // The first visit earns the achievement (and toasts it) and starts the fireworks by itself.
  // The toast first: it only lasts a few seconds, and the save behind it takes longer.
  await expect(page.locator("[data-toast='achievement']")).toContainText("Rooftop");
  await expect.poll(async () => (await stored())[0]?.achievements.rooftop, { timeout: 15_000 }).toBeTruthy();
  await page.waitForTimeout(2500);
  await shot(page, "rooftop-day");

  // The telescope zooms to Lahore's landmark with its fun fact; E steps back.
  await goTo(page, "rooftop", [roof.telescope[0] - 0.9, 0, roof.telescope[2]], Math.PI / 2);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("rooftop:telescope");
  await page.keyboard.press("e");
  const caption = page.locator("section[aria-labelledby='telescope-title']");
  await expect(caption).toContainText("Minar-e-Pakistan");
  await expect(caption).toContainText("Lahore Resolution");
  // The camera eases in over a few frames; SwiftShader draws the rooftop slowly, so give it time.
  await page.waitForTimeout(SHOTS ? 12_000 : 1500);
  await shot(page, "rooftop-telescope");
  await page.keyboard.press("e");
  await expect(caption).toBeHidden();

  // The wall of fame opens the achievements tab; the panel launches the fireworks.
  await goTo(page, "rooftop", [roof.plaque.use[0], 0, roof.plaque.use[2]], 0);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("rooftop:fame");
  await page.keyboard.press("e");
  const fame = page.locator("[data-slot='dialog-content']");
  await expect(fame.getByRole("tab", { name: /Achievements/ })).toHaveAttribute("aria-selected", "true");
  await expect(fame.locator("[data-achievement][data-unlocked='true']")).not.toHaveCount(0);
  await page.keyboard.press("Escape");
  await goTo(page, "rooftop", [roof.panel[0] - 0.8, 0, roof.panel[2]], Math.PI / 2);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("rooftop:fireworks");
  await page.keyboard.press("e");
  await page.waitForTimeout(1800);
  await shot(page, "rooftop-fireworks");

  // And back down: the lift lands at the corridor's end again.
  await goTo(page, "rooftop", [roof.lift.call[0], 0, roof.lift.call[2]], Math.PI);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("rooftop:lift");
  await page.keyboard.press("e");
  await waitReady(page, "office");
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Corridor");
});

test("a fresh player can't take the lift: it explains what is missing", async ({ page, context }) => {
  test.setTimeout(240_000);
  const other = await createTestUser("Test Office Quests Locked", { orgs: ["simtora"] });
  try {
    await other.officeQuery(
      `insert into {office}.players (user_id, display_name, avatar, settings) values ($1, 'Test L.', '{"top": "#2c3e63"}'::jsonb, '{"coach_done": true}'::jsonb)
       on conflict (user_id) do update set avatar = excluded.avatar, settings = excluded.settings`,
      [other.id],
    );
    await context.addCookies([{ name: SESSION_COOKIE, value: other.cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/simtora/lahore");
    await waitReady(page, "city");
    await goTo(page, "office", plan.spawns.lift.position, 0);
    await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe("door:lift");
    const focus = await page.evaluate(() => window.__office!.getState().focus);
    expect(focus).toMatchObject({ locked: true, reason: "Finish your core quests (0/5) to unlock the rooftop" });
    await page.keyboard.press("e");
    expect((await snapshot(page))?.scene).toBe("office");
    expect((await snapshot(page))?.unlocks).toEqual([]);
  } finally {
    await other.remove();
  }
});
