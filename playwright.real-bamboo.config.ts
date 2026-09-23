import { defineConfig, devices } from "@playwright/test";

const acceptanceMode = process.env.LOTUS_REAL_ACCEPTANCE_MODE?.trim();
const outputSuffix = acceptanceMode ? `-${acceptanceMode}` : "";
const secureRemote = acceptanceMode === "remote";
const desktopUse = {
  ...devices["Desktop Chrome"],
  browserName: "chromium" as const,
  viewport: { width: 1_440, height: 900 },
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "real-bamboo*.spec.ts",
  outputDir: `test-results-real-bamboo${outputSuffix}`,
  globalSetup: "./e2e/support/realBambooRuntime.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["line"],
    [
      "html",
      {
        open: "never",
        outputFolder: `playwright-report-real-bamboo${outputSuffix}`,
      },
    ],
  ],
  use: {
    colorScheme: "dark",
    ignoreHTTPSErrors: secureRemote,
    launchOptions: secureRemote
      ? {
          args: [
            "--host-resolver-rules=MAP remote.lotus.test 127.0.0.1",
          ],
        }
      : undefined,
    locale: "zh-CN",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "real-bamboo-desktop-chromium",
      testIgnore: "**/real-bamboo-browser-tabs.spec.ts",
      use: desktopUse,
    },
    {
      name: "real-bamboo-browser-tabs-chromium",
      testMatch: "**/real-bamboo-browser-tabs.spec.ts",
      dependencies: ["real-bamboo-desktop-chromium"],
      use: desktopUse,
    },
  ],
});
