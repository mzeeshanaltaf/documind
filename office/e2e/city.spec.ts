import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { skyAt } from "../src/game/world/city/lighting";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O4 › Tests (Playwright): the city scenes on the dev DB (Simtora).
//   OFFICE_SHOTS=<dir> also saves day and night screenshots of every city and the hub;
//   OFFICE_CITIES=paris,sydney limits the first test to those (while iterating on a kit).
test.describe.configure({ mode: "serial" });

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser("Test Office City", { orgs: ["simtora"] });
  // A saved look, so the first-visit avatar editor stays shut.
  await user.officeQuery(
    `insert into {office}.players (user_id, display_name, avatar) values ($1, 'Test', '{"top": "#2f6f5e"}'::jsonb)
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

type Snapshot = { scene: string; phase: string; position: [number, number, number]; room: string | null; place: string | null };

function snapshot(page: Page): Promise<Snapshot | null> {
  return page.evaluate(() => {
    const s = window.__office?.getState();
    if (!s) return null;
    return { scene: s.world.scene, phase: s.world.phase, position: s.player.position, room: s.world.location.room, place: s.office?.place.id ?? null };
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

async function open(page: Page, location: string) {
  await page.goto(`/simtora/${location}`);
  await waitReady(page, "city");
}

const CITIES = process.env.OFFICE_CITIES?.split(",") ?? ["san-francisco", "lahore", "berlin", "paris", "sydney", "london", "worldwide"];

test("every Simtora city and the Global Hub load, under 300 draw calls", async ({ page, context }) => {
  test.setTimeout(600_000);
  await signIn(context);
  const shots = process.env.OFFICE_SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const calls: Record<string, number[]> = {};

  for (const city of CITIES) {
    await open(page, city);
    expect((await snapshot(page))?.place).toBe(city);
    // Medium has shadows (a second pass for the casters). High adds post-processing, whose
    // composer leaves only its last pass in renderer.info, so medium is the scene's worst count.
    const callsAt = async (quality: "low" | "medium") => {
      await page.evaluate((q) => window.__office!.getState().updateSettings({ quality: q }), quality);
      await page.waitForTimeout(1200);
      return (await page.evaluate(() => window.__office!.render()))!.calls;
    };
    const medium = await callsAt("medium");
    const low = await callsAt("low");
    calls[city] = [low, medium];
    expect(medium).toBeLessThan(300);

    if (shots) {
      const shot = (name: string) => page.screenshot({ path: path.join(shots, `${city}-${name}.png`) });
      await page.evaluate(() => window.__office!.getState().updateSettings({ quality: "medium" }));
      await page.evaluate(() => window.__office!.getState().setClockHour(13));
      await page.waitForTimeout(2500);
      await shot("arrival-day");
      if (city === "worldwide") {
        await view(page, { at: [2, 0, 10], look: [11, -2], pitch: 0.3, distance: 8 });
        await shot("kiosks");
        await view(page, { at: [0, 0, 27.5], look: [0, 60], pitch: 0.35, distance: 8 });
        await shot("earth");
      } else {
        // From the plaza's north-east corner, towards the vista park and beyond.
        // A slightly raised view (negative pitch: the camera below head height looking up).
        await view(page, { at: [10, 0.12, 2], look: [45, -45], pitch: -0.1, distance: 7 });
        await shot("landmark-day");
        await page.evaluate(() => window.__office!.getState().setClockHour(22.5));
        await page.waitForTimeout(2000);
        await shot("landmark-night");
      }
      await page.evaluate(() => window.__office!.getState().setClockHour(null));
    }
  }
  console.log("Draw calls per city [low, medium]:", JSON.stringify(calls));
});

/** Holds a key until the scene changes to `scene`; returns how long that took. */
async function holdUntil(page: Page, key: string, scene: string) {
  const started = Date.now();
  await page.keyboard.down(key);
  try {
    await expect.poll(async () => (await snapshot(page))?.scene, { timeout: 10_000, intervals: [100] }).toBe(scene);
  } finally {
    await page.keyboard.up(key);
  }
  return Date.now() - started;
}

test("Berlin: straight on from the spawn walks into the office, and back out to the street", async ({ page, context }) => {
  // A smaller canvas keeps SwiftShader near real-time, so walking speed is what it would be.
  await page.setViewportSize({ width: 800, height: 450 });
  await signIn(context);
  await open(page, "berlin");
  const banner = page.getByRole("status").filter({ hasText: "local time" });
  await expect(banner).toContainText("Berlin");
  await expect(banner).toContainText("Simtora R&D centre");

  // The spawn faces the doors: ArrowUp alone reaches the office within 10 s.
  expect(await holdUntil(page, "ArrowUp", "office")).toBeLessThan(10_000);
  await waitReady(page, "office");
  expect((await snapshot(page))?.room).toBe("Lobby");
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Lobby");

  // Back out through the street doors behind the spawn: outside the entrance again.
  expect(await holdUntil(page, "ArrowDown", "city")).toBeLessThan(10_000);
  await waitReady(page, "city");
  const [x, , z] = (await snapshot(page))!.position;
  expect(Math.hypot(x + 4, z - 3.2)).toBeLessThan(1.5);
  await expect(page.getByRole("navigation", { name: "Location" })).not.toContainText("Lobby");
});

test("day and night follow Berlin's real local time, and the debug clock flips them", async ({ page, context }) => {
  await signIn(context);
  await open(page, "berlin");
  const isNight = () => page.evaluate(() => window.__office!.getState().sky?.isNight ?? null);
  const expected = skyAt(Date.now(), 52.52, 13.405).isNight;
  await expect.poll(isNight).toBe(expected);

  await page.keyboard.press("Escape");
  await expect(page.getByText("Time of day (dev)")).toBeVisible();
  await expect(page.getByText("Real time")).toBeVisible();
  await page.keyboard.press("Escape");

  for (const [hour, night] of [
    [2, true],
    [13, false],
    [23, true],
  ] as const) {
    await page.evaluate((h) => window.__office!.getState().setClockHour(h), hour);
    await expect.poll(isNight).toBe(night);
  }
  await page.evaluate(() => window.__office!.getState().setClockHour(null));
  await expect.poll(isNight).toBe(expected);
});

test("a Global Hub kiosk travels to Berlin", async ({ page, context }) => {
  await signIn(context);
  await open(page, "worldwide");
  await expect(page.getByRole("status").filter({ hasText: "Global Hub" })).toContainText("Kiosks lead to every Simtora office");
  await expect.poll(() => page.evaluate(() => window.__office!.getState().interactables.size)).toBeGreaterThanOrEqual(6);

  // Step up to Berlin's kiosk.
  const [x, z] = await page.evaluate(() => {
    const kiosk = window.__office!.getState().interactables.get("kiosk-berlin")!.object;
    kiosk.updateWorldMatrix(true, false);
    const { elements } = kiosk.matrixWorld;
    return [elements[12], elements[14]];
  });
  await page.evaluate(([px, pz]) => window.__office!.getState().transitionTo("city", { position: [px, 0, pz], yaw: 0 }), [x, z]);
  await waitReady(page, "city");
  await expect.poll(() => page.evaluate(() => window.__office!.getState().focus?.id ?? null)).toBe("kiosk-berlin");

  await page.keyboard.press("e");
  await expect(page.getByRole("heading", { name: "Travel to Berlin?" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Simtora's Berlin R&D centre");
  await page.getByRole("button", { name: "Travel" }).click();
  await expect(page).toHaveURL(/\/simtora\/berlin$/, { timeout: 30_000 });
  await waitReady(page, "city");
  expect((await snapshot(page))?.place).toBe("berlin");
  // Next keeps the hub's route mounted but hidden; only Berlin's canvas shows.
  await expect(page.locator("canvas:visible")).toHaveCount(1);

  // Back to the hub: the kept route shows again and restarts as the hub, not as Berlin.
  await page.goBack();
  await expect(page).toHaveURL(/\/simtora\/worldwide$/);
  await waitReady(page, "city");
  await expect.poll(async () => (await snapshot(page))?.place).toBe("worldwide");
  await expect(page.locator("canvas:visible")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Location" })).toContainText("Global Hub");
});

/** Respawns the player at `at` and swings the camera round to look towards `look` (x, z). */
async function view(
  page: Page,
  { at, look, pitch, distance }: { at: [number, number, number]; look: [number, number]; pitch: number; distance: number },
) {
  const facing = Math.atan2(look[0] - at[0], look[1] - at[2]);
  await page.evaluate(([position, yaw]) => window.__office!.getState().transitionTo("city", { position, yaw }), [at, facing] as const);
  await waitReady(page, "city");
  await page.evaluate(
    ([yaw, p, d]) => {
      const { rig } = window.__office!;
      rig.yaw = yaw;
      rig.pitch = p;
      rig.distance = d;
    },
    [facing + Math.PI, pitch, distance] as const,
  );
  await page.waitForTimeout(2000);
}
