import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const source = [
  "# 懒加载排版检查",
  "中文与 Latin **重点**、`inline_code`，以及[文档链接](https://example.test/docs)。",
  "| 项目 | 说明 |\n| --- | --- |\n| 正文 | 保留布局 |",
  '```typescript\nconst greeting = "中文 English";\n```',
  '```mermaid\nflowchart LR\n  A["中文输入"] --> B["Readable output"]\n```',
].join("\n\n")

for (const theme of ["light", "dark"] as const) {
  test(`lazy renderer utilities preserve code, links and diagrams in ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "paired-theme optional renderer stylesheet regression")
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript((mode) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("copilot_ui_theme_v1", mode)
    }, theme)
    const observation = await installArtifactRuntime(page, standaloneScenario, [{
      id: "lazy-renderer-styles", role: "assistant", content: source, created_at: "2026-10-22T00:00:00Z",
    }])
    await page.goto(standaloneScenario.entryUrl)
    const markdown = page.locator(".assistant-streamdown").filter({ hasText: "懒加载排版检查" })
    await expect(markdown.locator("table")).toBeVisible()
    await expect(markdown.locator('[data-streamdown="code-block-body"] span[style]').first()).toBeVisible()
    await expect(markdown.locator('[data-mermaid-state="ready"] svg')).toBeVisible()
    await expect(markdown.locator('[data-mermaid-state="ready"]')).toContainText("中文输入")
    await markdown.getByRole("button", { name: "文档链接", exact: true }).click()
    const dialog = page.locator('[data-streamdown="link-safety-modal"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("https://example.test/docs")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      expect(await markdown.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
      await markdown.locator("h1").scrollIntoViewIfNeeded()
      await info.attach(`lazy-renderer-${theme}-${width}`, { body: await page.screenshot({ fullPage: true, caret: "initial" }), contentType: "image/png" })
    }
    expect(observation.consoleErrors).toEqual([])
    expect(observation.pageErrors).toEqual([])
    expect(observation.errorResponses).toEqual([])
  })
}
