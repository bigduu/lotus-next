import { expect, test } from "@playwright/test"
import { artifactFileForSource, installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const source = [
  "# 懒加载排版检查",
  "中文与 Latin **重点**、`inline_code`，以及[文档链接](https://example.test/docs)。",
  "| 项目 | 说明 |\n| --- | --- |\n| 正文 | 保留布局 |",
  '```typescript\nconst greeting = "中文 English";\n```',
  '```mermaid\nflowchart LR\n  A["中文输入"] --> B["Readable output"]\n```',
].join("\n\n")

for (const theme of ["light", "dark"] as const) {
  test(`lazy Markdown renderer preserves code, links and diagrams in ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "paired-theme optional renderer stylesheet regression")
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript((mode) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("copilot_ui_theme_v1", mode)
    }, theme)
    const observation = await installArtifactRuntime(page, standaloneScenario, [{
      id: "lazy-renderer-styles", role: "assistant", content: source, created_at: "2026-10-22T00:00:00Z",
    }])
    const optionalAssets = await Promise.all([
      artifactFileForSource("src/solid/markdown/highlight/highlightCode.ts"),
      artifactFileForSource("src/solid/markdown/renderMermaid.ts"),
    ])
    await page.goto(standaloneScenario.entryUrl)
    const markdown = page.locator(".assistant-streamdown").filter({ hasText: "懒加载排版检查" })
    await expect(markdown.locator("table")).toBeVisible()
    await expect(markdown.locator('[data-streamdown="code-block-body"] span[style]').first()).toBeVisible()
    const image = markdown.locator('[data-mermaid-state="ready"]').getByRole("img", { name: "Mermaid 图表" })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const diagramLabels = await image.evaluate(async (node) => {
      const response = await fetch((node as HTMLImageElement).currentSrc)
      const diagram = new DOMParser().parseFromString(await response.text(), "image/svg+xml")
      return Array.from(diagram.querySelectorAll("svg text"), (label) => label.textContent)
    })
    expect(diagramLabels).toContain("中文输入")
    expect(diagramLabels).toContain("Readable output")
    await markdown.getByRole("link", { name: "文档链接", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "打开外部链接？", exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("https://example.test/docs")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(standaloneScenario.entryUrl)
    expect(observation.httpRequests.some(({ url }) => url === "https://example.test/docs")).toBe(false)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      expect(await markdown.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
      await markdown.locator("h1").scrollIntoViewIfNeeded()
      await info.attach(`lazy-renderer-${theme}-${width}`, { body: await page.screenshot({ fullPage: true, caret: "initial" }), contentType: "image/png" })
    }
    const assets = observation.staticUrls.map((url) => new URL(url).pathname)
    expect(assets).toEqual(expect.arrayContaining(optionalAssets.map((file) => `/${file}`)))
    expect(observation.consoleErrors).toEqual([])
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
