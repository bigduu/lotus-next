import { defineConfig } from "@playwright/test"

// Source-only synthetic UI evidence; no build, Bamboo process or provider calls.
export default defineConfig({
  testDir: "./e2e", testMatch: "config-share.spec.ts", workers: 1,
  outputDir: "test-results/config-share", timeout: 45_000,
  reporter: "line",
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:4188", colorScheme: "dark", locale: "en-US", screenshot: "off", trace: "off", video: "off" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4188 --strictPort --logLevel error",
    url: "http://127.0.0.1:4188", reuseExistingServer: false,
  },
  projects: [
    { name: "share-desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "share-phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
