import { defineConfig, devices } from "@playwright/test";

const port = 9575;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e/solid",
  testMatch: "**/*.e2e.ts",
  use: { baseURL, locale: "zh-CN", colorScheme: "dark" },
  webServer: {
    command: `vite preview --config vite.solid.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
