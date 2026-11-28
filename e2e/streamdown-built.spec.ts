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

test("folds a provider tool before the lazy Markdown parser is available", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "uses the same parser asset on all viewports")
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  })
  const input = "provider-private-fixture-input"
  const output = "provider-completed-fixture-output"
  const intro = "Prose remains readable during parser load"
  const observation = await installArtifactRuntime(page, standaloneScenario, [{
    role: "assistant",
    content: `${intro}\n\n**🌐 Z.ai Built-in Tool: analyze_image**\n**Input:** ${input}\n**Output:** ${output}`,
    timestamp: "2026-09-03T00:00:00.000Z",
  }])
  const parser = await artifactFileForSource("src/solid/markdown/AssistantMarkdown.tsx")
  let releaseParser!: () => void
  const heldParser = new Promise<void>((resolve) => { releaseParser = resolve })
  await page.route(`**/${parser}`, async (route) => {
    await heldParser
    await route.fallback()
  })

  const transcript = page.locator("[data-message-list-content]")
  const visibleProse = transcript.locator(".assistant-streamdown", { hasText: intro })
  const toggle = page.getByRole("button", { name: "Built-in tool · analyze_image", exact: true })
  try {
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    await expect(page.locator("[data-assistant-markdown-fallback]", { hasText: intro })).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(transcript).not.toContainText(input)
    await expect(transcript).not.toContainText(output)
  } finally {
    releaseParser()
  }

  await expect(visibleProse).toBeVisible()
  await expect(transcript).not.toContainText(input)
  await expect(transcript).not.toContainText(output)
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const details = page.locator('[data-provider-tool="analyze_image"] .assistant-streamdown')
  await expect(details).toContainText(input)
  await expect(details).toContainText(output)
  await toggle.click()
  await expect(transcript).not.toContainText(input)
  expect(observation.pageErrors).toEqual([])
  expect(observation.failedRequests).toEqual([])
})

test("keeps textual tool arguments out of restored Markdown", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
  })
  const intro = "Preparing the example"
  const script = "# A script comment\n\n# An internal label\n" + "sample".repeat(120)
  const call = `<function=edit_sample><parameter=text>\n${script}\n</parameter></function>`
  const observation = await installArtifactRuntime(page, standaloneScenario, [{
    role: "assistant",
    content: `${intro}:${call}\n\n## Result summary`,
    timestamp: "2026-09-03T00:00:00.000Z",
  }])
  const parser = await artifactFileForSource("src/solid/markdown/AssistantMarkdown.tsx")
  let releaseParser!: () => void
  const heldParser = new Promise<void>((resolve) => { releaseParser = resolve })
  await page.route(`**/${parser}`, async (route) => {
    await heldParser
    await route.fallback()
  })

  const transcript = page.locator("[data-message-list-content]")
  const toggle = transcript.getByRole("button", { name: "Tool · edit_sample" })
  try {
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })
    await expect(transcript.locator("[data-assistant-markdown-fallback]", { hasText: intro })).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(transcript).not.toContainText("A script comment")
  } finally {
    releaseParser()
  }

  await expect(transcript.getByRole("heading", { name: "Result summary", level: 2 })).toBeVisible()
  await expect(transcript.getByRole("heading", { name: "A script comment" })).toHaveCount(0)
  if (testInfo.project.name === "desktop-chromium") {
    await testInfo.attach("Folded tool text in the transcript", {
      body: await transcript.screenshot(),
      contentType: "image/png",
    })
  }
  await toggle.click()
  const details = transcript.locator('[data-provider-tool="edit_sample"] pre')
  await expect(details).toBeVisible()
  expect(await details.textContent()).toBe(call)
  expect(await details.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  expect(observation.pageErrors).toEqual([])
})
