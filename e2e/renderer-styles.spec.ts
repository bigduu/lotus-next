import { expect, test } from "@playwright/test"
import { artifactFileForSource, installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const source = [
  "# Markdown 排版对照",
  "中文与 Latin **重点**、`inline_code`，以及[文档链接](https://example.test/docs)。",
  "## 排版检查",
  "> 确认引用的标记和间距。",
  "- 普通条目\n  - 嵌套条目",
  "| 项目 | 说明 |\n| --- | --- |\n| 正文 | 保留布局 |",
  '```typescript\nconst greeting = "中文 English";\n```',
  '```mermaid\nflowchart LR\n  A["中文输入"] --> B["Readable output"]\n```',
].join("\n\n")

for (const theme of ["light", "dark"] as const) {
  test(`lazy Markdown renderer preserves code, links and diagrams in ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "paired-theme optional renderer stylesheet regression")
    await page.setViewportSize({ width: 1440, height: 1100 })
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
    const markdown = page.locator(".assistant-streamdown").filter({ hasText: "Markdown 排版对照" })
    await expect(markdown.locator("table")).toBeVisible()
    await expect(markdown.locator('[data-streamdown="code-block-body"] span[style]').first()).toBeVisible()
    const image = markdown.locator('[data-mermaid-state="ready"]').getByRole("img", { name: "Mermaid 图表" })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await page.evaluate(() => document.fonts.ready)
    const diagramLabels = await image.evaluate(async (node) => {
      const response = await fetch((node as HTMLImageElement).currentSrc)
      const diagram = new DOMParser().parseFromString(await response.text(), "image/svg+xml")
      return Array.from(diagram.querySelectorAll("svg text"), (label) => label.textContent)
    })
    expect(diagramLabels).toContain("中文输入")
    expect(diagramLabels).toContain("Readable output")
    // Measure the rendered elements because Typography can override fallback utility styles.
    const heading = markdown.getByRole("heading", { level: 1 })
    await expect(heading).toHaveCSS("font-size", "30px")
    await expect(heading).toHaveCSS("font-weight", "600")
    await expect(heading).toHaveCSS("margin-block-start", "0px")
    await expect(markdown.getByRole("heading", { level: 2 })).toHaveCSS("font-weight", "600")
    const inline = markdown.locator('[data-streamdown="inline-code"]')
    await expect(inline).toHaveCSS("border-radius", "4px")
    await expect(inline).toHaveCSS("padding-inline-start", "6px")
    await expect(inline).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    const fence = markdown.locator('[data-streamdown="code-block-body"]')
    await expect(fence).toHaveCSS("border-top-width", "1px")
    await expect(fence.locator("pre")).toHaveCSS("margin-block", "0px")
    await expect(fence.locator("code")).toHaveCSS("font-size", "14px")
    await expect(markdown.locator('[data-streamdown="table-wrapper"]')).toHaveCSS("padding-inline-start", "8px")
    await expect(markdown.getByRole("columnheader").first()).toHaveCSS("padding-inline-start", "16px")
    await expect(markdown.locator("thead")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
    await expect(markdown.locator("ul").first()).toHaveCSS("list-style-position", "inside")
    await expect(markdown.locator("li").first()).toHaveCSS("padding-block", "4px")
    await expect(markdown.locator("blockquote")).toHaveCSS("border-left-width", "4px")
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
      expect(await heading.evaluate((node) => node.getBoundingClientRect().height)).toBe(36)
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
