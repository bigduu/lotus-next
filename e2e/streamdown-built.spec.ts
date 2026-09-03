import { expect, test } from "@playwright/test"
import {
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"

const ASSISTANT_MARKER = "streamdown-built-artifact-marker"

test("production artifact mounts Streamdown for a plain assistant response", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "one desktop regression is sufficient")

  await page.addInitScript(() => {
    const browserGlobal = globalThis as unknown as {
      localStorage: { setItem(key: string, value: string): void }
    }
    browserGlobal.localStorage.setItem("bodhi_onboarded_v1", "1")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario, [
    {
      role: "assistant",
      content: ASSISTANT_MARKER,
      timestamp: "2026-09-03T00:00:00.000Z",
    },
  ])

  await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
  const renderer = page.locator(".assistant-streamdown", {
    hasText: ASSISTANT_MARKER,
  })
  await expect(renderer).toBeVisible()
  await expect(
    page.locator('[data-assistant-markdown-fallback="true"]', {
      hasText: ASSISTANT_MARKER,
    }),
  ).toHaveCount(0)
  await page.waitForLoadState("networkidle")

  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.failedRequests).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
