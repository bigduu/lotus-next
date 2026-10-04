import { defineConfig, devices } from "@playwright/test"
export default defineConfig({
  testDir: "./e2e", testMatch: "ticket-runtime.spec.ts", workers: 1, retries: 0,
  timeout: 150_000, expect: { timeout: 25_000 },
  outputDir: "test-results-tickets", reporter: [["line"], ["html", { open: "never", outputFolder: "playwright-report-tickets" }]],
  use: { ...devices["Desktop Chrome"], browserName: "chromium", viewport: { width: 1440, height: 1000 },
    locale: "zh-CN", colorScheme: "dark", screenshot: "only-on-failure", trace: "retain-on-failure" },
})
