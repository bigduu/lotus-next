import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "real-bamboo*.spec.ts",
  outputDir: "test-results-real-bamboo",
  globalSetup: "./e2e/support/realBambooRuntime.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report-real-bamboo" }],
  ],
  use: {
    colorScheme: "dark",
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "real-bamboo-desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1_440, height: 900 },
      },
    },
  ],
});
