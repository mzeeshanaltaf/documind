import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O7 › Tests (Playwright): a non-admin Simtora member in Lahore, on the dev DB.
//   1. Walk from the lobby into the presentation room; sit (E): the camera frames the screen and
//      the lights dim; → through all 16 slides: `presentation_watched` fires once per deck (the
//      event log in `window.__office` until O9); the video slide shows no DOM slide; "View full
//      screen" pages by keyboard and reads at 360 px; E stands up; standing, the loop advances.
//   2. The presenter: a real answer (one billed DocuMind chat) scoped to SIM-OVR-001 that cites it.
//   3. OFFICE_SHOTS=<dir>: the room, the seated view, the full-screen slide (light, dark, 360 px).
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.OFFICE_SHOTS;
const PROGRAMME = 16;

// Simtora's floor plan: the presentation room is x -22…-8, z -7…7, its door from the lobby at
// (-8, 3). Seat 1-3 (front row, third from the north) is at (-16.6, -2.45); "E · Sit" is offered
// 0.62 m in front of it. The presenter stands on the stage at (-20.75, 2.1).
const IN_FRONT_OF_SEAT: [number, number, number] = [-17.3, 0, -2.45];
const BY_THE_PRESENTER: [number, number, number] = [-18.45, 0, 2.6];

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Test Office Auditorium", { orgs: ["simtora"] });
  await user.officeQuery(
    `insert into {office}.players (user_id, display_name, avatar) values ($1, 'Test A.', '{"top": "#2c3e63"}'::jsonb)
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

type Snapshot = { scene: string; phase: string; room: string | null; focus: string | null; modal: string | null; pose: string; seat: string | null; slide: number; count: number };

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
      pose: s.player.pose,
      seat: s.player.seat?.id ?? null,
      slide: s.presentation.slide,
      count: s.presentation.count,
    };
  });
}

async function waitReady(page: Page, scene: string) {
  await expect.poll(async () => {
    const s = await snapshot(page);
    return s ? `${s.scene}:${s.phase}` : "booting";
  }, { timeout: 120_000 }).toBe(`${scene}:ready`);
}

/** Into the office at `position`, the camera turned so ↑ walks `cameraYaw`'s way. */
async function enterOffice(page: Page, position: [number, number, number], cameraYaw = 0) {
  await page.evaluate(
    ([p]) => window.__office!.getState().transitionTo("office", { position: p as [number, number, number], yaw: 0 }),
    [position],
  );
  await waitReady(page, "office");
  await page.evaluate((yaw) => {
    window.__office!.rig.yaw = yaw;
  }, cameraYaw);
}

function watched(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__office!.events.filter((e) => e.type === "presentation_watched").map((e) => (e as { deck: string }).deck));
}

async function exposure(page: Page): Promise<number> {
  return (await page.evaluate(() => window.__office!.render()))!.exposure;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `presentation-${name}.png`) });
}

test("the auditorium: sit, page through every slide, full screen, stand, and the loop runs", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1024, height: 576 });
  await signIn(context);
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");

  // From the lobby, walk west through the open door into the room.
  await enterOffice(page, [-5, 0, 3], Math.PI / 2);
  await page.keyboard.down("ArrowUp");
  try {
    await expect.poll(async () => (await snapshot(page))?.room, { timeout: 20_000, intervals: [100] }).toBe("Presentation room");
  } finally {
    await page.keyboard.up("ArrowUp");
  }
  await expect.poll(async () => (await snapshot(page))?.count).toBe(PROGRAMME);
  const bar = page.locator("[data-presentation-bar]");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "View full screen" })).toBeVisible();
  // The screen shows a DOM slide (unless the loop is on the video right now).
  await expect.poll(async () => (await page.locator("[data-slide-screen]").count()) + ((await snapshot(page))?.slide === 1 ? 1 : 0)).toBe(1);
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));
  await page.waitForTimeout(1500);
  const calls = (await page.evaluate(() => window.__office!.render()))!.calls;
  console.log("Presentation room draw calls (medium):", calls);
  expect(calls).toBeLessThan(300);
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));
  await shot(page, "room");

  // Sit in the front row: E.
  await enterOffice(page, IN_FRONT_OF_SEAT);
  await expect.poll(async () => (await snapshot(page))?.focus).toBe("seat:1-3");
  await page.keyboard.press("e");
  await expect.poll(async () => (await snapshot(page))?.seat).toBe("seat:1-3");
  await expect(bar.getByRole("button", { name: "Stand up" })).toBeVisible();
  await expect.poll(() => exposure(page), { timeout: 10_000 }).toBeLessThan(0.65);
  // The seated shot: the camera is within 4.7 m of the screen, looking at it.
  const camera = await page.evaluate(() => {
    const r = window.__office!.rig;
    return { x: r.position.x, hidden: r.cameraTooClose };
  });
  expect(camera.hidden).toBe(true);

  // Start from the first slide, then → through the whole programme.
  await page.evaluate(() => window.__office!.getState().showSlide(0));
  await page.waitForTimeout(300);
  await shot(page, "seated");
  const seenTitles: string[] = [];
  for (let i = 0; i < PROGRAMME; i++) {
    const s = (await snapshot(page))!;
    expect(s.slide).toBe(i);
    expect(s.pose).toBe("sit");
    const screen = page.locator("[data-slide-screen]");
    if (i === 1) {
      // The explainer plays on the screen itself: no DOM slide.
      await expect(screen).toHaveCount(0);
      await page.waitForTimeout(3000);
      await shot(page, "video");
    } else {
      await expect(screen).toHaveCount(1);
      seenTitles.push((await screen.getAttribute("data-slide-screen")) ?? "");
    }
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await snapshot(page))?.slide).toBe((i + 1) % PROGRAMME);
  }
  expect(seenTitles.filter(Boolean)).toHaveLength(PROGRAMME - 1);
  expect((await watched(page)).sort()).toEqual(["company", "documind"]);
  // ← goes back, and a second lap fires nothing new.
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await snapshot(page))?.slide).toBe(PROGRAMME - 1);
  for (let i = 0; i < PROGRAMME; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  expect(await watched(page)).toHaveLength(2);
  expect((await snapshot(page))?.pose).toBe("sit");

  // View full screen, by keyboard: Tab to the button, Enter; → pages; Esc closes.
  // Slide 9: "Our story", the company deck's second.
  await page.evaluate(() => window.__office!.getState().showSlide(9));
  const fullScreen = bar.getByRole("button", { name: "View full screen" });
  await fullScreen.focus();
  await page.keyboard.press("Enter");
  // The slide's title names the dialog.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Our story" })).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Our story");
  await expect(dialog).toContainText("Source: SIM-OVR-001 · p. 4");
  await shot(page, "full-screen");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Mission, vision and values");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Global footprint");
  await expect(dialog).toContainText("You are here: Lahore");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "full-screen-dark");
  await page.emulateMedia({ colorScheme: "light" });

  // Readable at 360 px: nothing scrolls sideways, body text stays ≥ 14 px.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const popup = document.querySelector('[role="dialog"]') as HTMLElement;
    const article = popup.querySelector("article") as HTMLElement;
    const scroller = article.parentElement as HTMLElement;
    const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    const withText = [...article.querySelectorAll("*")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()));
    // Body copy (the lead and the office rows) vs. every label (part mark, badges, footnote).
    const body = Math.min(...[...article.querySelectorAll(":scope > div p, :scope li > span:not([class*=rounded])")].map(size));
    return { popup: popup.getBoundingClientRect().width, overflow: scroller.scrollWidth - scroller.clientWidth, body, any: Math.min(...withText.map(size)) };
  });
  expect(fit.popup).toBeLessThanOrEqual(360);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.body).toBeGreaterThanOrEqual(14);
  expect(fit.any).toBeGreaterThanOrEqual(12);
  await shot(page, "full-screen-360");
  await page.setViewportSize({ width: 1024, height: 576 });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await snapshot(page))?.pose).toBe("sit");

  // E stands up; the lights come back; the loop then runs by itself.
  await page.keyboard.press("e");
  await expect.poll(async () => (await snapshot(page))?.pose).toBe("stand");
  await expect.poll(() => exposure(page), { timeout: 10_000 }).toBeGreaterThan(0.95);
  const standing = (await snapshot(page))!.slide;
  await expect.poll(async () => (await snapshot(page))?.slide, { timeout: 30_000 }).not.toBe(standing);

  // Esc stands up too.
  await enterOffice(page, IN_FRONT_OF_SEAT);
  await expect.poll(async () => (await snapshot(page))?.focus).toBe("seat:1-3");
  await page.keyboard.press("e");
  await expect.poll(async () => (await snapshot(page))?.pose).toBe("sit");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await snapshot(page))?.pose).toBe("stand");
  expect((await snapshot(page))?.modal).toBeNull();
});

type Turn = { status: string; routingIds: string[]; cited: (string | null)[] };

test("the presenter answers from the company overview and cites it", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1024, height: 576 });
  await signIn(context);
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");
  await enterOffice(page, BY_THE_PRESENTER);
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 20_000 }).toBe("npc:presenter");

  await page.keyboard.press("e");
  const dialog = page.locator("[data-npc-dialogue]");
  await expect(dialog.getByRole("heading", { name: "Noor Abbasi" })).toBeVisible();
  await expect(dialog).toContainText("Presenter · Lahore");
  await expect(dialog).toContainText("Overview · 1 document");
  await expect(dialog).toContainText("I answer from the company overview.");
  for (const chip of ["When was Simtora founded?", "Where are the R&D centres?", "What are the company values?"]) {
    await expect(dialog.getByRole("button", { name: chip })).toBeVisible();
  }
  await shot(page, "presenter");

  await dialog.getByRole("button", { name: "When was Simtora founded?" }).click();
  const key = "lahore:presenter";
  await expect
    .poll(() => page.evaluate((k) => window.__office!.getState().chat[k]?.turns.at(-1)?.status, key), { timeout: 120_000 })
    .toBe("complete");
  const turn = (await page.evaluate((k) => {
    const last = window.__office!.getState().chat[k]!.turns.at(-1)!;
    return { status: last.status, routingIds: last.routing?.document_ids ?? [], cited: last.citations.map((c) => c.doc_code) };
  }, key)) as Turn;
  const overview = await page.evaluate(() => window.__office!.getState().office!.documents.find((d) => d.doc_code === "SIM-OVR-001")!.id);
  console.log("Presenter routed:", turn.routingIds, "cited:", turn.cited.join(", "));
  expect(turn.routingIds).toEqual([overview]);
  expect(turn.cited.length).toBeGreaterThan(0);
  for (const code of turn.cited) expect(code).toBe("SIM-OVR-001");
  await expect(dialog).toContainText("2016");
  const events = await page.evaluate(() => window.__office!.events.filter((e) => e.type === "question_asked"));
  expect(events).toEqual([expect.objectContaining({ npc: "presenter", department: null, location: "lahore" })]);
});
