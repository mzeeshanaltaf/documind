import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against `pnpm dev` on :3200 (reused if it's already running). They need the dev
 * DB (a throwaway user is created and deleted per file). Headless Chromium renders WebGL with
 * SwiftShader, so frame rates here say nothing about real performance.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3200",
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3200/robots.txt",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
