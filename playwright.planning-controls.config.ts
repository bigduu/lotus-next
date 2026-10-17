import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./e2e", testMatch: ["project-work-controls.spec.ts", "project-work-board-controls.spec.ts", "project-work-assignment-health.spec.ts"], workers: 1, retries: 0,
  timeout: 30_000, outputDir: "test-results/planning-controls", reporter: [["line"]],
  use: { baseURL: "http://127.0.0.1:19575", browserName: "chromium", locale: "en-US", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 19575 --strictPort", url: "http://127.0.0.1:19575/e2e/fixtures/project-work-controls.html", reuseExistingServer: false, timeout: 30_000 },
})
