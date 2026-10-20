import { tmpdir } from "node:os"
import path from "node:path"
import { defineConfig } from "@playwright/test"

const output = process.env.LOTUS_SPRINT_REVIEW_DIR ?? path.join(tmpdir(), "lotus-sprint-browser-review")
export default defineConfig({
  testDir: "./e2e",
  testMatch: "project-work-sprints.pw.ts",
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: path.join(output, "artifacts"),
  reporter: [["line"], ["json", { outputFile: path.join(output, "playwright-results.json") }]],
  use: {
    baseURL: "http://127.0.0.1:19576", browserName: "chromium", locale: "zh-CN",
    viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 19576 --strictPort",
    url: "http://127.0.0.1:19576/e2e/fixtures/project-sprints.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
