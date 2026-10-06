import { defineConfig, devices } from "@playwright/test"

if (!process.env.LOTUS_ACTOR_FIXTURE_INFO) {
  throw new Error("Set LOTUS_ACTOR_FIXTURE_INFO to the ignored native Bamboo Actor fixture rendezvous JSON")
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "actor-native-runtime.spec.ts",
  outputDir: "test-results-actor-runtime",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report-actor-runtime" }]],
  use: { actionTimeout: 15_000, colorScheme: "dark", locale: "zh-CN", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "native-actor-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
})
