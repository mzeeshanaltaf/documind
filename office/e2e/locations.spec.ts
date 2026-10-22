import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { formatLocalTime } from "../src/lib/format";
import { createTestUser, SESSION_COOKIE, type TestUser } from "./support/test-user";

// Phase O3 › Tests (Playwright): org and location selection on the dev DB (Simtora).
test.describe.configure({ mode: "serial" });

let member: TestUser;
let outsider: TestUser;
let admin: TestUser;

test.beforeAll(async () => {
  [member, outsider, admin] = await Promise.all([
    createTestUser("Test Office Member", { orgs: ["simtora"] }),
    createTestUser("Test Office Outsider"),
    createTestUser("Test Office Admin", { admin: true }),
  ]);
});

test.afterAll(async () => {
  await Promise.all([member?.remove(), outsider?.remove(), admin?.remove()]);
});

async function signIn(context: BrowserContext, user: TestUser) {
  await context.addCookies([
    { name: SESSION_COOKIE, value: user.cookie, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

const CITIES = ["San Francisco", "Berlin", "Lahore", "London", "Paris", "Sydney"];

/** The globe's label cards (a pointer-only layer, hidden from assistive tech). */
const globeLabels = (page: Page) => page.locator("div[aria-hidden] > button[tabindex='-1']");

/** Tabs forward until `target` has focus: proves it's reachable by keyboard alone. */
async function tabTo(page: Page, target: ReturnType<Page["locator"]>, limit = 25) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("a member of only Simtora lands on its globe and picks Lahore by keyboard", async ({ page, context }) => {
  await signIn(context, member);
  await page.goto("/");
  await expect(page).toHaveURL(/\/simtora$/);
  await expect(page.getByRole("heading", { name: "Choose an office" })).toBeVisible();

  const offices = page.getByRole("list", { name: "Offices" }).getByRole("link");
  await expect(offices).toHaveCount(7);
  await expect(offices.first()).toContainText("San Francisco");
  await expect(offices.first()).toContainText("Headquarters");
  await expect(offices.last()).toContainText("Global Hub");
  for (const [index, city] of CITIES.entries()) await expect(offices.nth(index)).toContainText(city);
  await expect(page.getByRole("link", { name: /^Lahore/ })).toContainText("Local policies: SIM-HR-101");

  // Local times match the city's zone (either side of a minute tick).
  const sydney = page.getByRole("link", { name: /^Sydney/ });
  const before = formatLocalTime(Date.now() - 60_000, "Australia/Sydney");
  const after = formatLocalTime(Date.now() + 60_000, "Australia/Sydney");
  const now = formatLocalTime(Date.now(), "Australia/Sydney");
  const sydneyText = (await sydney.textContent()) ?? "";
  expect([before, now, after].some((time) => sydneyText.includes(time))).toBe(true);

  // One pin label per office once the globe has drawn.
  await expect(globeLabels(page)).toHaveCount(6, { timeout: 60_000 });
  for (const city of CITIES) await expect(globeLabels(page).filter({ hasText: city })).toHaveCount(1);

  const lahore = page.getByRole("link", { name: /^Lahore/ });
  await tabTo(page, lahore);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/simtora\/lahore$/, { timeout: 30_000 });

  // The game opens with the office context (the city itself is a placeholder until O4).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const state = window.__office?.getState();
          return state ? `${state.world.scene}:${state.office?.place.id}:${state.world.location.city}` : null;
        }),
      { timeout: 120_000 },
    )
    .toBe("city:lahore:Lahore");

  await expect
    .poll(async () => {
      const [progress] = await member.officeQuery<{ stats: { cities_visited?: string[] } }>(
        `select stats from {office}.progress where user_id = $1`,
        [member.id],
      );
      return progress?.stats.cities_visited ?? null;
    })
    .toEqual(["lahore"]);
  const [player] = await member.officeQuery<{ settings: Record<string, unknown> }>(
    `select settings from {office}.players where user_id = $1`,
    [member.id],
  );
  expect(player.settings).toMatchObject({ last_location: "lahore" });
});

test("offers to resume the last visit, on the globe and the org list", async ({ page, context }) => {
  await signIn(context, member);
  await page.goto("/simtora");
  await expect(page.getByRole("link", { name: "Resume in Lahore" })).toBeVisible();

  await page.goto("/?pick=1");
  await expect(page.getByRole("heading", { name: "Choose an organization" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resume in Lahore" })).toHaveAttribute("href", "/simtora/lahore");
  await expect(page.getByRole("list", { name: "Your organizations" }).getByRole("link")).toHaveCount(1);
});

test("an unknown location and a non-member both get not found", async ({ page, context, browser }) => {
  await signIn(context, member);
  await page.goto("/simtora/atlantis");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();

  const other = await browser.newContext();
  try {
    await signIn(other, outsider);
    const outsiderPage = await other.newPage();
    await outsiderPage.goto("/simtora");
    await expect(outsiderPage.getByRole("heading", { name: "Not found" })).toBeVisible();
    await outsiderPage.goto("/simtora/lahore");
    await expect(outsiderPage.getByRole("heading", { name: "Not found" })).toBeVisible();
    await outsiderPage.goto("/");
    await expect(outsiderPage.getByText("You're not in an organization yet")).toBeVisible();
  } finally {
    await other.close();
  }
});

test("an admin sees every org except the eval ones", async ({ page, context }) => {
  await signIn(context, admin);
  await page.goto("/?pick=1");
  const orgs = page.getByRole("list", { name: "Your organizations" });
  await expect(orgs.getByRole("link", { name: /Simtora Technologies/ })).toBeVisible();
  await expect(orgs.getByText("Platform admin").first()).toBeVisible();
  await expect(orgs.getByText(/Canary|eval-canary/)).toHaveCount(0);

  await page.goto("/eval-canary");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the globe stays still and a choice fades straight to the office", async ({ page, context }) => {
    await signIn(context, member);
    await page.goto("/simtora");
    const berlin = globeLabels(page).filter({ hasText: "Berlin" });
    await expect(globeLabels(page)).toHaveCount(6, { timeout: 60_000 });

    // Whatever side of the globe is showing, some label is up; it must not drift.
    const visible = globeLabels(page).filter({ visible: true }).first();
    await expect(visible).toBeVisible({ timeout: 30_000 });
    const first = await visible.evaluate((element) => element.style.transform);
    await page.waitForTimeout(1500);
    expect(await visible.evaluate((element) => element.style.transform)).toBe(first);

    // The globe turned to Berlin when its row took focus (instantly), so its label is showing.
    await page.getByRole("link", { name: /^Berlin/ }).focus();
    await expect(berlin).toBeVisible();
    await page.getByRole("link", { name: /^Paris/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Opening the office" })).toBeVisible();
    await expect(page).toHaveURL(/\/simtora\/paris$/, { timeout: 30_000 });
  });
});
