import { type BrowserContext, devices, expect, type Page, test } from "@playwright/test";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O2 › Tests (Playwright): the sandbox through the dev-only `window.__office` handle.
test.describe.configure({ mode: "serial" });

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  await user?.remove();
});

async function signedIn(context: BrowserContext) {
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

type Snapshot = {
  phase: string;
  scene: string;
  position: [number, number, number];
  pose: string;
  focus: string | null;
  modal: string | null;
  quality: string;
  avatarTop: string;
};

function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const office = window.__office;
    if (!office) return null;
    const s = office.getState();
    return {
      phase: s.world.phase,
      scene: s.world.scene,
      position: s.player.position,
      pose: s.player.pose,
      focus: s.focus?.id ?? null,
      modal: s.modal?.type ?? null,
      quality: s.settings.quality,
      avatarTop: s.player.avatar.top,
    };
  });
}

async function waitReady(page: Page, scene = "sandbox") {
  await expect
    .poll(async () => {
      const s = await snapshot(page);
      return s ? `${s.scene}:${s.phase}` : "booting";
    }, { timeout: 120_000 })
    .toBe(`${scene}:ready`);
}

/** Opens the sandbox; a player who never saved a look gets the editor first, which we skip. */
async function enter(page: Page, { firstLook = true } = {}) {
  await page.goto("/dev/sandbox");
  await waitReady(page);
  if (firstLook) {
    await expect(page.getByRole("heading", { name: "Choose your look" })).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
  }
  await expect.poll(async () => (await snapshot(page))?.modal ?? "none").toBe("none");
}

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test("walks with ArrowUp, and ignores movement while the menu is open", async ({ page, context }) => {
  await signedIn(context);
  await enter(page);

  const start = (await snapshot(page))!.position;
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1000);
  await page.keyboard.up("ArrowUp");
  await expect.poll(async () => distance((await snapshot(page))!.position, start)).toBeGreaterThan(0.5);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await page.waitForTimeout(300);
  const paused = (await snapshot(page))!.position;
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(300);
  expect(distance((await snapshot(page))!.position, paused)).toBeLessThan(0.02);

  await page.keyboard.press("Escape");
  await expect.poll(async () => (await snapshot(page))?.modal ?? "none").toBe("none");
});

test("sits on the chair with E", async ({ page, context }) => {
  await signedIn(context);
  await enter(page);

  // Respawn just in front of the chair (it faces -z from (3.5, -2.5)).
  await page.evaluate(() => window.__office!.getState().transitionTo("sandbox", { position: [3.5, 0, -3.5], yaw: 0 }));
  await waitReady(page);
  await expect.poll(async () => (await snapshot(page))?.focus).toBe("sandbox-chair");
  await expect(page.getByRole("button", { name: "Sit" })).toBeVisible();

  await page.keyboard.press("e");
  await expect.poll(async () => (await snapshot(page))?.pose).toBe("sit");
});

test("five scene transitions don't grow GPU memory", async ({ page, context }) => {
  await signedIn(context);
  await enter(page);
  const memory = () => page.evaluate(() => window.__office!.memory()!);
  // R3F disposes on an idle callback; give it a moment before reading.
  await page.waitForTimeout(1000);
  const first = await memory();
  const sandboxReadings = [first];

  for (const scene of ["city", "sandbox", "city", "sandbox", "city", "sandbox"] as const) {
    await page.evaluate((target) => window.__office!.getState().transitionTo(target, { position: [0, 0, 4], yaw: Math.PI }), scene);
    await waitReady(page, scene);
    await page.waitForTimeout(1000);
    if (scene === "sandbox") sandboxReadings.push(await memory());
  }

  console.log("GPU memory on each sandbox entry:", JSON.stringify(sandboxReadings));
  const last = sandboxReadings.at(-1)!;
  expect(last.geometries).toBeLessThanOrEqual(first.geometries);
  expect(last.textures).toBeLessThanOrEqual(first.textures);
});

test("quality switches live and settings survive a reload", async ({ page, context }) => {
  await signedIn(context);
  await enter(page);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: /^high$/i }).click();
  await expect.poll(() => page.evaluate(() => window.__office!.render()?.shadows)).toBe(true);
  await page.getByRole("button", { name: /^low$/i }).click();
  await expect.poll(() => page.evaluate(() => window.__office!.render()?.shadows)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__office!.render()?.pixelRatio)).toBe(1);

  // Past the save debounce, then reload: the DB row (and the mirror) keep "low".
  await page.waitForTimeout(1500);
  await page.reload();
  await waitReady(page);
  expect((await snapshot(page))?.quality).toBe("low");
});

test.describe("on a phone", () => {
  // A touch device: `(pointer: coarse)` matches, so the joystick and touch buttons show.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("walks with the touch joystick", async ({ page, context }) => {
    await signedIn(context);
    await enter(page);
    const stick = page.locator('[data-touch="joystick"]');
    await expect(stick).toBeVisible();
    await expect(page.getByRole("button", { name: "Use" })).toBeVisible();

    const box = (await stick.boundingBox())!;
    const start = (await snapshot(page))!.position;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x, centre.y - 40, { steps: 4 });
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await expect.poll(async () => distance((await snapshot(page))!.position, start)).toBeGreaterThan(0.5);
  });
});

test("a saved look persists across reloads", async ({ page, context }) => {
  await signedIn(context);
  await enter(page);

  await page.evaluate(() => window.__office!.getState().openModal({ type: "avatar" }));
  await expect(page.getByRole("heading", { name: "Your look" })).toBeVisible();
  // Click the visible swatch (its radio is visually hidden), then check the radio followed.
  const top = page.getByRole("group", { name: "Top" });
  await top.getByTitle("Brick").click();
  await expect(top.getByRole("radio", { name: "Brick" })).toBeChecked();
  await page.getByRole("button", { name: "Save look" }).click();
  await expect(page.getByText("Look saved")).toBeVisible();

  await page.reload();
  await enter(page, { firstLook: false });
  expect((await snapshot(page))?.avatarTop).toBe("#9c4535");
});
