import { expect, test } from "@playwright/test"
import {
  artifactFileForSource,
  installArtifactRuntime,
  standaloneScenario,
} from "./support/artifactRuntime.js"

const ASSISTANT_MARKER = "markdown-built-artifact-marker"

test("production artifact loads the Markdown parser for a plain assistant response", async ({
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
  const [parser, highlighter, mermaid] = await Promise.all([
    artifactFileForSource("src/solid/markdown/AssistantMarkdown.tsx"),
    artifactFileForSource("src/solid/markdown/highlight/highlightCode.ts"),
    artifactFileForSource("src/solid/markdown/renderMermaid.ts"),
  ])
  let releaseParser!: () => void
  const heldParser = new Promise<void>((resolve) => { releaseParser = resolve })
  await page.route(`**/${parser}`, async (route) => {
    await heldParser
    await route.fallback()
  })

  try {
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    await expect(page.locator('[data-assistant-markdown-fallback="true"]', { hasText: ASSISTANT_MARKER })).toBeVisible()
  } finally {
    releaseParser()
  }
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

  const assets = observation.staticUrls.map((url) => new URL(url).pathname)
  expect(assets).toContain(`/${parser}`)
  expect(assets).not.toContain(`/${highlighter}`)
  expect(assets).not.toContain(`/${mermaid}`)
  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.failedRequests).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
