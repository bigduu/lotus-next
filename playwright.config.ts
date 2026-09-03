import { defineConfig, devices } from "@playwright/test"

const chromium = { browserName: "chromium" as const }

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    colorScheme: "dark",
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: process.env.CI ? "retain-on-failure-and-retries" : "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...chromium,
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...chromium,
        viewport: { width: 820, height: 1_180 },
        hasTouch: true,
      },
    },
    {
      name: "phone-chromium",
      use: {
        ...devices["Pixel 7"],
        ...chromium,
      },
    },
  ],
})
