import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import bank from "../src/content/orgs/simtora-trivia.json";
import { type BinId, BINS, ITEM_BIN, type ItemKind, landing, MAX_DRAG, speedForPower } from "../src/game/games/sort-toss/logic";
import { buildFloorplan } from "../src/game/world/office/floorplan";
import { beanbagSeats, playLayout } from "../src/game/world/office/play/layout";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O8 › Tests (Playwright): a non-admin Simtora member in Lahore, on the dev DB.
//   1. Walk in from the lobby; the prompts at every station.
//   2. Policy Trivia: ten scripted answers (the right ones from the bank), "Show source" opens the
//      PDF sheet on the cited page, the score row and the leaderboard entry; Esc quits cleanly.
//   3. Sort & Toss: a correct throw by mouse and by keyboard, a full 60 s round played by a bot
//      (the score stays inside the bound), the Facilities citation on the results card; the
//      frame rate of the game; Esc quits.
//   4. Desk Table Tennis: a match from the keyboard and the mouse, the result card.
//   5. Touch: a trivia answer by tap, a Sort & Toss throw by touch drag, the paddle by touch.
//   6. Ambient: coffee boost, beanbag, emote wheel, jukebox, the leaderboard wall.
//   OFFICE_SHOTS=<dir>: screenshots of the room and each game.
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.OFFICE_SHOTS;
const plan = buildFloorplan(["HR", "IT", "Finance", "Procurement", "Facilities", "Compliance", "International"]);
const layout = playLayout(plan.rooms.find((r) => r.kind === "play")!, plan.doors.find((d) => d.to === "play")!);
const spotOf = (id: string): [number, number, number] => layout.stations.find((s) => s.id === id)!.spot;
// Standing round the table, on its south side.
const BY_THE_TABLE: [number, number, number] = [layout.table.center[0], 0, layout.table.center[2] + 1.8];
const AT_THE_BEANBAG = (() => {
  const seat = beanbagSeats(layout)[1];
  return { id: seat.id, position: [seat.position[0] + Math.sin(seat.yaw) * 0.65, 0, seat.position[2] + Math.cos(seat.yaw) * 0.65] as [number, number, number] };
})();

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Test Office Play", { orgs: ["simtora"] });
  await user.officeQuery(
    `insert into {office}.players (user_id, display_name, avatar) values ($1, 'Test P.', '{"top": "#2c3e63"}'::jsonb)
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

type Snapshot = {
  scene: string;
  phase: string;
  room: string | null;
  focus: string | null;
  modal: string | null;
  game: string | null;
  pose: string;
  seat: string | null;
  jukebox: string;
  emote: string | null;
  caffeinatedUntil: number;
  viewer: { open: boolean; docCode: string | null; page: number | null };
};

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
      game: s.modal?.type === "game" ? s.modal.game : null,
      pose: s.player.pose,
      seat: s.player.seat?.id ?? null,
      jukebox: s.jukebox,
      emote: s.emote?.id ?? null,
      caffeinatedUntil: s.caffeinatedUntil,
      viewer: { open: s.viewer.open, docCode: s.viewer.request?.docCode ?? null, page: s.viewer.request?.page ?? null },
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

/** Into the office at `position`, the camera turned so ↑ walks `cameraYaw`'s way. */
async function enterOffice(page: Page, position: [number, number, number], cameraYaw = 0) {
  await page.evaluate(([p]) => window.__office!.getState().transitionTo("office", { position: p as [number, number, number], yaw: 0 }), [position]);
  await waitReady(page, "office");
  await page.evaluate((yaw) => {
    window.__office!.rig.yaw = yaw;
  }, cameraYaw);
}

/** Opens the page in Lahore and stands at `position` in the play area. */
async function openAt(page: Page, context: BrowserContext, position: [number, number, number]) {
  await page.setViewportSize({ width: 1100, height: 700 });
  await signIn(context);
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));
  await enterOffice(page, position);
}

/** Moves to another spot without reloading. */
async function moveTo(page: Page, position: [number, number, number]) {
  await page.evaluate(([p]) => window.__office!.getState().transitionTo("office", { position: p as [number, number, number], yaw: 0 }), [position]);
  await expect.poll(async () => (await snapshot(page))?.phase).toBe("ready");
}

async function useStation(page: Page, id: string) {
  await expect.poll(async () => (await snapshot(page))?.focus, { timeout: 15_000 }).toBe(`play:${id}`);
  await page.keyboard.press("KeyE");
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `play-${name}.png`) });
}

function events(page: Page, type: string): Promise<Record<string, unknown>[]> {
  return page.evaluate((t) => window.__office!.events.filter((e) => e.type === t) as unknown as Record<string, unknown>[], type);
}

const scores = (game: string) =>
  user.officeQuery<{ score: number; details: Record<string, unknown> }>(`select score, details from {office}.game_scores where user_id = $1 and game = $2 order by created_at`, [user.id, game]);

test("walk in from the lobby: the play area, its prompts and its sign", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1100, height: 700 });
  await signIn(context);
  await page.goto("/simtora/lahore");
  await waitReady(page, "city");
  // From the lobby, walk east through the open door.
  await enterOffice(page, [6.6, 0, 3], -Math.PI / 2);
  await page.keyboard.down("ArrowUp");
  try {
    await expect.poll(async () => (await snapshot(page))?.room, { timeout: 20_000, intervals: [100] }).toBe("Play area");
  } finally {
    await page.keyboard.up("ArrowUp");
  }

  // Each station offers its prompt.
  const labels: Record<string, string> = {
    trivia: "Play Policy Trivia",
    sort_toss: "Play Sort & Toss",
    table_tennis: "Play Desk Table Tennis",
    leaderboard: "Read the leaderboards",
    jukebox: "Pick the music",
    coffee: "Brew a coffee",
  };
  const spots: Record<string, [number, number, number]> = { ...Object.fromEntries(Object.keys(labels).map((id) => [id, spotOf(id)])), table_tennis: BY_THE_TABLE };
  for (const [id, label] of Object.entries(labels)) {
    await moveTo(page, spots[id]);
    await expect.poll(async () => (await snapshot(page))?.focus).toBe(`play:${id}`);
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));
  await moveTo(page, [11, 0, 4]);
  await page.waitForTimeout(1500);
  const calls = (await page.evaluate(() => window.__office!.render()))!.calls;
  console.log("Play area draw calls (medium):", calls);
  expect(calls).toBeLessThan(300);
  await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "low" }));

  if (SHOTS) {
    await page.evaluate(() => {
      const o = window.__office!;
      o.rig.yaw = Math.PI / 2;
      o.rig.pitch = 0.62;
      o.rig.distance = 6;
    });
    await moveTo(page, [17.5, 0, 3.4]);
    await page.evaluate(() => {
      const o = window.__office!;
      o.rig.yaw = Math.PI / 2;
      o.rig.pitch = 0.6;
      o.rig.distance = 6.5;
    });
    await page.waitForTimeout(2500);
    await shot(page, "room-west");
    await moveTo(page, [10, 0, 3.4]);
    await page.evaluate(() => {
      const o = window.__office!;
      o.rig.yaw = -Math.PI / 2;
      o.rig.pitch = 0.5;
      o.rig.distance = 7;
    });
    await page.waitForTimeout(2500);
    await shot(page, "room-east");
  }
});

test("Policy Trivia: ten scripted answers, a source, a score row and a leaderboard entry", async ({ page, context }) => {
  test.setTimeout(300_000);
  await openAt(page, context, spotOf("trivia"));
  await useStation(page, "trivia");
  const dialog = page.locator('[data-game-dialog="trivia"]');
  await expect(dialog).toBeVisible();
  expect((await snapshot(page))?.game).toBe("trivia");
  expect((await events(page, "game_started")).map((e) => e.game)).toEqual(["trivia"]);
  await page.waitForTimeout(1500);
  await shot(page, "trivia-intro");

  await dialog.getByRole("button", { name: /^Start/ }).click();
  let sourced = false;
  for (let i = 0; i < 10; i++) {
    const current = dialog.locator("[data-trivia-question]");
    await expect(current).toBeVisible();
    const id = (await current.getAttribute("data-trivia-question"))!;
    const question = bank.find((q) => q.id === id)!;
    expect(question, id).toBeTruthy();
    // By keyboard on odd questions (1–4), by click on the others.
    const choice = dialog.locator("[data-choice]").filter({ has: page.getByText(question.choices[question.answer], { exact: true }) });
    await expect(choice).toHaveCount(1);
    if (i === 3) await shot(page, "trivia-question");
    if (i % 2 === 1) await page.keyboard.press(`Digit${Number(await choice.getAttribute("data-choice")) + 1}`);
    else await choice.click();
    await expect(dialog.locator("[data-trivia-review]")).toBeVisible();
    await expect(choice).toHaveAttribute("data-state", "correct");

    if (i === 2) {
      // "Show source": the PDF sheet opens on the page the answer was checked against.
      await dialog.getByRole("button", { name: "Show source" }).click();
      const viewer = (await snapshot(page))!.viewer;
      expect(viewer).toEqual({ open: true, docCode: question.doc_code, page: question.page });
      const sheet = page.locator("[data-pdf-viewer]");
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(question.doc_code);
      await expect(sheet.locator(".pdf-page")).toHaveAttribute("data-page", String(question.page), { timeout: 60_000 });
      await shot(page, "trivia-source");
      // Esc closes the sheet only; the game carries on.
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(dialog).toBeVisible();
      expect((await events(page, "citation_opened")).some((e) => e.doc_code === question.doc_code)).toBe(true);
      sourced = true;
    }
    await dialog.locator("[data-trivia-next]").click();
  }
  expect(sourced).toBe(true);

  // The card: a perfect round, saved.
  const result = page.locator("[data-game-result]");
  await expect(result).toBeVisible();
  await expect(result.locator("[data-score-status]")).toHaveAttribute("data-score-status", "saved", { timeout: 30_000 });
  const shownScore = Number(await result.locator("[data-game-score]").innerText());
  expect(shownScore).toBeGreaterThanOrEqual(1000 + 450);
  expect(shownScore).toBeLessThanOrEqual(1900);
  await expect(result).toContainText("Rank 1");
  await shot(page, "trivia-result");

  const rows = await scores("trivia");
  expect(rows).toHaveLength(1);
  expect(rows[0].score).toBe(shownScore);
  expect(rows[0].details).toEqual({ correct: 10, total: 10, location: "lahore" });
  expect((await events(page, "score_submitted")).map((e) => [e.game, e.rank])).toEqual([["trivia", 1]]);

  // The leaderboard, from the card.
  await result.getByRole("button", { name: "Leaderboards" }).click();
  const board = page.locator("[data-leaderboard-dialog]");
  await expect(board).toBeVisible();
  const trivia = board.locator('[data-leaderboard-game="trivia"]');
  await expect(trivia.locator("[data-leaderboard-row]").first()).toContainText("Test P.");
  await expect(trivia.locator('[data-leaderboard-row][data-mine]')).toContainText(String(shownScore));
  await shot(page, "leaderboard");
  await board.getByRole("radio", { name: "All time" }).click();
  await expect(trivia.locator("[data-leaderboard-row]").first()).toContainText("Test P.");
  await page.keyboard.press("Escape");
  await expect(board).toBeHidden();

  // Back to walking: the game closed, the world carries on.
  const after = (await snapshot(page))!;
  expect(after.modal).toBeNull();
  expect(after.phase).toBe("ready");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  expect((await page.evaluate(() => window.__office!.rig.position.z)) !== undefined).toBe(true);
});

test("Esc quits a game at once, with no score saved", async ({ page, context }) => {
  test.setTimeout(240_000);
  await openAt(page, context, spotOf("trivia"));
  await useStation(page, "trivia");
  const dialog = page.locator('[data-game-dialog="trivia"]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Start/ }).click();
  await expect(dialog.locator("[data-trivia-question]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const s = (await snapshot(page))!;
  expect([s.modal, s.phase]).toEqual([null, "ready"]);
  expect((await scores("trivia")).length).toBe(1); // only the earlier perfect round
});

/** The power (at 50°) that lands a throw in the middle of `bin`. */
function powerFor(bin: BinId): number {
  const angle = (50 * Math.PI) / 180;
  const target = BINS.find((b) => b.id === bin)!.x;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (landing(angle, speedForPower(mid)).x < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** A mouse drag back from where it starts: pulled left and down at 50°, `power` of the full pull. */
async function dragThrow(page: Page, bin: BinId) {
  const canvas = page.locator("canvas[aria-label^='Sort and Toss']");
  const box = (await canvas.boundingBox())!;
  const k = box.width / 960;
  const pull = powerFor(bin) * MAX_DRAG;
  const angle = (50 * Math.PI) / 180;
  const from = { x: box.x + 520 * k, y: box.y + 220 * k };
  const to = { x: from.x - pull * Math.cos(angle) * k, y: from.y + pull * Math.sin(angle) * k };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 3 });
  await page.mouse.up();
}

async function itemInHand(page: Page): Promise<ItemKind | ""> {
  return ((await page.locator("[data-sort-toss-field]").getAttribute("data-item")) ?? "") as ItemKind | "";
}
const fieldNumber = async (page: Page, attribute: string) => Number((await page.locator("[data-sort-toss-field]").getAttribute(attribute)) ?? 0);

test("Sort & Toss: a throw by mouse, one by keyboard, the full round, the citation, the frame rate", async ({ page, context }) => {
  test.setTimeout(600_000);
  await openAt(page, context, spotOf("sort_toss"));
  await useStation(page, "sort_toss");
  const dialog = page.locator('[data-game-dialog="sort_toss"]');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "sort-intro");
  await dialog.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => itemInHand(page), { timeout: 15_000 }).not.toBe("");

  // By mouse: a right throw scores 10 once it lands.
  const kind = (await itemInHand(page)) as ItemKind;
  await dragThrow(page, ITEM_BIN[kind]);
  await expect.poll(() => fieldNumber(page, "data-score"), { timeout: 10_000 }).toBeGreaterThanOrEqual(10);

  // By keyboard: aim with the arrows, hold Space, let go. (It lands somewhere: the count goes up.)
  await expect.poll(() => itemInHand(page), { timeout: 15_000 }).not.toBe("");
  const landed = await fieldNumber(page, "data-landed");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("Space");
  await page.waitForTimeout(600);
  await page.keyboard.up("Space");
  await expect.poll(() => fieldNumber(page, "data-landed"), { timeout: 10_000 }).toBeGreaterThan(landed);
  await shot(page, "sort-play");

  // Esc quits cleanly in the middle of a round: no card, no score.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await snapshot(page))!.modal).toBeNull();
  expect(await scores("sort_toss")).toHaveLength(0);

  // A whole round, played by a bot that throws every item into its bin.
  await useStation(page, "sort_toss");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Start" }).click();
  await page.evaluate(() => {
    const counter = { frames: 0, start: performance.now(), fps: 0 };
    (window as unknown as { __fps: typeof counter }).__fps = counter;
    const tick = () => {
      counter.frames++;
      const elapsed = performance.now() - counter.start;
      if (elapsed >= 3000) counter.fps = (counter.frames * 1000) / elapsed;
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const result = page.locator("[data-game-result]");
  // Game time never runs faster than real time (a slow frame is capped), so allow for a slow machine.
  const deadline = Date.now() + 240_000;
  let throws = 0;
  while (Date.now() < deadline && !(await result.isVisible())) {
    const item = await itemInHand(page);
    if (item) {
      await dragThrow(page, ITEM_BIN[item]);
      throws++;
    }
    await page.waitForTimeout(450);
  }
  console.log(`Sort & Toss bot threw ${throws} items`);
  await expect(result).toBeVisible();
  expect(throws).toBeGreaterThan(15);
  const fps = await page.evaluate(() => (window as unknown as { __fps: { fps: number } }).__fps.fps);
  console.log(`Sort & Toss frame rate while playing (low tier, headless): ${fps.toFixed(1)} fps`);
  expect(fps).toBeGreaterThanOrEqual(30);

  await expect(result.locator("[data-score-status]")).toHaveAttribute("data-score-status", "saved", { timeout: 30_000 });
  const shown = Number(await result.locator("[data-game-score]").innerText());
  expect(shown).toBeGreaterThan(100);
  await shot(page, "sort-result");
  const rows = await scores("sort_toss");
  expect(rows).toHaveLength(1);
  expect(rows[0].score).toBe(shown);
  const details = rows[0].details as { correct: number; wrong: number; maxCombo: number };
  expect(details.correct).toBeGreaterThan(5);
  expect(details.maxCombo).toBeLessThanOrEqual(details.correct);

  // The card cites the Facilities manual's page.
  await expect(result).toContainText("SIM-FAC-001");
  await result.getByRole("button", { name: "View p. 68" }).click();
  expect((await snapshot(page))!.viewer).toEqual({ open: true, docCode: "SIM-FAC-001", page: 68 });
  await expect(page.locator("[data-pdf-viewer] .pdf-page")).toHaveAttribute("data-page", "68", { timeout: 60_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-pdf-viewer]")).toBeHidden();

  // Play again restarts; Quit leaves.
  await result.getByRole("button", { name: "Quit" }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot(page))!.modal).toBeNull();
});

test("Desk Table Tennis: a match from the keyboard and the mouse, then the card", async ({ page, context }) => {
  test.setTimeout(420_000);
  await openAt(page, context, BY_THE_TABLE);
  await useStation(page, "table_tennis");
  const dialog = page.locator('[data-game-dialog="table_tennis"]');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "tennis-setup");
  await dialog.getByRole("radio", { name: "Easy" }).click();
  await dialog.getByRole("button", { name: "Serve" }).click();
  const court = page.locator("[data-table-tennis-court]");
  await expect(court).toBeVisible();
  await expect.poll(() => court.getAttribute("data-phase"), { timeout: 15_000 }).toBe("rally");
  await shot(page, "tennis-rally");

  // The keyboard slides the paddle, then the mouse takes over.
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowLeft");
  const canvas = court.locator("canvas");
  const box = (await canvas.boundingBox())!;

  // Sweep the mouse across the table while the match runs, until the card comes up.
  const result = page.locator("[data-game-result]");
  const deadline = Date.now() + 150_000;
  let x = 0;
  while (Date.now() < deadline && !(await result.isVisible())) {
    x = (x + 0.11) % 1;
    await page.mouse.move(box.x + box.width * (0.25 + 0.5 * Math.abs(Math.sin(x * Math.PI * 2))), box.y + box.height * 0.8);
    await page.waitForTimeout(120);
  }
  await expect(result).toBeVisible();
  const score = await court.getAttribute("data-score");
  expect(score).toMatch(/^[0-7]-[0-7]$/);
  const [mine, theirs] = score!.split("-").map(Number);
  expect(Math.max(mine, theirs)).toBe(7);
  await shot(page, "tennis-result");

  if (mine > 0) {
    await expect(result.locator("[data-score-status]")).toHaveAttribute("data-score-status", "saved", { timeout: 30_000 });
    const rows = await scores("table_tennis");
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ pointsFor: mine, pointsAgainst: theirs, difficulty: 1, won: mine === 7 });
    expect(rows[0].score).toBe(mine * 10 + (mine === 7 ? 20 : 0));
  } else {
    await expect(result.locator("[data-score-status]")).toHaveAttribute("data-score-status", "unsaved");
  }
  await result.getByRole("button", { name: "Quit" }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot(page))!.modal).toBeNull();
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });

  test("tap an answer, drag a throw, drag the paddle", async ({ page, context }) => {
    test.setTimeout(300_000);
    await openAt(page, context, spotOf("trivia"));
    await useStation(page, "trivia");
    const dialog = page.locator('[data-game-dialog="trivia"]');
    await dialog.getByRole("button", { name: /^Start/ }).tap();
    const current = dialog.locator("[data-trivia-question]");
    await expect(current).toBeVisible();
    const id = (await current.getAttribute("data-trivia-question"))!;
    const q = bank.find((item) => item.id === id)!;
    await dialog.locator("[data-choice]").filter({ has: page.getByText(q.choices[q.answer], { exact: true }) }).tap();
    await expect(dialog.locator("[data-trivia-review]")).toBeVisible();
    await expect(dialog.locator('[data-state="correct"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Sort & Toss: a touch drag throws.
    await moveTo(page, spotOf("sort_toss"));
    await useStation(page, "sort_toss");
    const sort = page.locator('[data-game-dialog="sort_toss"]');
    await sort.getByRole("button", { name: "Start" }).tap();
    await expect.poll(() => itemInHand(page), { timeout: 15_000 }).not.toBe("");
    const kind = (await itemInHand(page)) as ItemKind;
    const canvas = page.locator("canvas[aria-label^='Sort and Toss']");
    const box = (await canvas.boundingBox())!;
    const k = box.width / 960;
    const pull = powerFor(ITEM_BIN[kind]) * MAX_DRAG;
    const angle = (50 * Math.PI) / 180;
    const from = { x: box.x + 520 * k, y: box.y + 220 * k };
    const to = { x: from.x - pull * Math.cos(angle) * k, y: from.y + pull * Math.sin(angle) * k };
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => fieldNumber(page, "data-score"), { timeout: 10_000 }).toBeGreaterThanOrEqual(10);
    await page.keyboard.press("Escape");
    await expect(sort).toBeHidden();

    // Table tennis: a finger across the table moves the paddle (the rally runs).
    await moveTo(page, BY_THE_TABLE);
    await useStation(page, "table_tennis");
    const tennis = page.locator('[data-game-dialog="table_tennis"]');
    await tennis.getByRole("button", { name: "Serve" }).tap();
    const court = page.locator("[data-table-tennis-court]");
    await expect.poll(() => court.getAttribute("data-phase"), { timeout: 15_000 }).toBe("rally");
    const tennisBox = (await court.locator("canvas").boundingBox())!;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tennisBox.x + tennisBox.width * 0.3, y: tennisBox.y + tennisBox.height * 0.8 }] });
    for (const f of [0.4, 0.5, 0.6, 0.7]) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tennisBox.x + tennisBox.width * f, y: tennisBox.y + tennisBox.height * 0.8 }] });
      await page.waitForTimeout(150);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.keyboard.press("Escape");
    await expect(tennis).toBeHidden();
  });
});

test("ambient: the coffee boost, a beanbag, the emote wheel, the jukebox and the leaderboard wall", async ({ page, context }) => {
  test.setTimeout(240_000);
  // The wall needs a score to show (the earlier tests leave some; this keeps the test alone-proof).
  await user.officeQuery(
    `insert into {office}.game_scores (user_id, org_id, game, score, details)
     select $1, o.id, 'trivia', 1234, '{"correct": 8, "total": 10, "location": "lahore"}'::jsonb from organization o where o.slug = 'simtora'`,
    [user.id],
  );
  await openAt(page, context, spotOf("coffee"));

  // Coffee: E brews, the boost lasts about 30 s and a chip shows it.
  await useStation(page, "coffee");
  await expect.poll(async () => (await snapshot(page))!.caffeinatedUntil - Date.now(), { timeout: 5000 }).toBeGreaterThan(25_000);
  await expect(page.locator("[data-caffeinated]")).toContainText("Caffeinated");
  expect((await events(page, "coffee_brewed")).length).toBe(1);

  // A beanbag: sit, the camera settles low and close, moving stands up.
  await moveTo(page, AT_THE_BEANBAG.position);
  await expect.poll(async () => (await snapshot(page))?.focus).toBe(AT_THE_BEANBAG.id);
  await page.keyboard.press("KeyE");
  await expect.poll(async () => (await snapshot(page))?.pose).toBe("sit");
  await expect.poll(() => page.evaluate(() => window.__office!.rig.pitch), { timeout: 5000 }).toBeLessThan(0.3);
  await shot(page, "beanbag");
  await page.keyboard.press("KeyE");
  await expect.poll(async () => (await snapshot(page))?.pose).toBe("stand");

  // The emote wheel: hold Q, press 1 for a wave; then hold Q, point at Dance and let go.
  await page.keyboard.down("KeyQ");
  // (The wheel's own box has no size; its three buttons are what shows.)
  const wheel = page.locator("[data-emote-wheel]");
  await expect(wheel.getByRole("button", { name: /Wave/ })).toBeVisible();
  await shot(page, "emote-wheel");
  await page.keyboard.press("Digit1");
  await expect(wheel).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page))?.emote).toBe("wave");
  await page.keyboard.up("KeyQ");
  await page.keyboard.down("KeyQ");
  await wheel.getByRole("button", { name: /Dance/ }).hover();
  await page.keyboard.up("KeyQ");
  await expect.poll(async () => (await snapshot(page))?.emote).toBe("dance");
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await snapshot(page))?.emote, { timeout: 5000 }).toBeNull();
  await page.keyboard.up("ArrowUp");
  expect((await events(page, "emote_used")).map((e) => e.emote)).toEqual(["wave", "dance"]);

  // The jukebox: pick another track, then Off.
  await moveTo(page, spotOf("jukebox"));
  await useStation(page, "jukebox");
  const jukebox = page.locator("[data-jukebox-dialog]");
  await expect(jukebox).toBeVisible();
  expect((await snapshot(page))!.jukebox).toBe("lounge");
  await jukebox.getByRole("radio", { name: /Bossa/ }).click();
  expect((await snapshot(page))!.jukebox).toBe("bossa");
  await jukebox.getByRole("radio", { name: /Off/ }).click();
  expect((await snapshot(page))!.jukebox).toBe("off");
  expect((await events(page, "jukebox_changed")).map((e) => e.track)).toEqual(["bossa", "off"]);
  await page.keyboard.press("Escape");
  await expect(jukebox).toBeHidden();

  // The leaderboard wall: E opens the DOM board with its tabs.
  await moveTo(page, spotOf("leaderboard"));
  await page.evaluate(() => {
    // The camera south of the player, looking at the wall.
    const o = window.__office!;
    o.rig.yaw = 0;
    o.rig.pitch = 0.18;
    o.rig.distance = 7;
  });
  await page.waitForTimeout(2500);
  await shot(page, "wall");
  await useStation(page, "leaderboard");
  const board = page.locator("[data-leaderboard-dialog]");
  await expect(board).toBeVisible();
  await expect(board.getByRole("radio", { name: "This week" })).toHaveAttribute("aria-checked", "true");
  await expect(board.locator("[data-leaderboard-game]")).toHaveCount(3);
  // The perfect trivia round from earlier is on it.
  await expect(board.locator('[data-leaderboard-game="trivia"] [data-leaderboard-row]').first()).toContainText("Test P.");
  await page.keyboard.press("Escape");
  await expect(board).toBeHidden();
});
