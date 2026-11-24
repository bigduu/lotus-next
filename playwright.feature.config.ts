import { defineConfig } from "@playwright/test";
import original from "./playwright.config.ts";

const solidCases = "**/solid/*.e2e.ts";
const testIgnore = [...[original.testIgnore ?? []].flat(), "**/solid/preview.e2e.ts"];
const port = 9576;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...original,
  testMatch: ["**/*.spec.ts", solidCases],
  testIgnore,
  webServer: {
    command: `vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
  },
  use: { ...original.use, baseURL },
  projects: original.projects?.map((project) => project.name === "tablet-chromium"
    ? { ...project, testIgnore: [...testIgnore, solidCases] }
    : project),
});
