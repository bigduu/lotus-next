import { defineConfig, devices } from "@playwright/test";

const chromium = { browserName: "chromium" as const };
const solidCases = "**/solid/*.e2e.ts";
const testIgnore = ["real-bamboo*.spec.ts", "ticket-runtime.spec.ts", "actor-native-runtime.spec.ts", "**/solid/preview.e2e.ts"];
const port = 9576;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts", solidCases],
  testIgnore,
  webServer: {
    command: `vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
  },
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
    baseURL,
    colorScheme: "dark",
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: process.env.CI
      ? "retain-on-failure-and-retries"
      : "retain-on-failure",
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
      testIgnore: [...testIgnore, solidCases],
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
});
