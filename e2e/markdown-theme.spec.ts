import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { markdownThemeFixture } from "./support/markdownThemeFixture.js"

for (const theme of ["light", "dark"] as const) {
  test(`rich Markdown stays readable in ${theme} at wide and narrow widths`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "one paired-theme viewport regression")
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript((mode) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("copilot_ui_theme_v1", mode)
    }, theme)
    const observation = await installArtifactRuntime(page, standaloneScenario, [{ role: "assistant", content: markdownThemeFixture, timestamp: "2026-09-03T00:00:00.000Z" }])
    await page.goto(standaloneScenario.entryUrl)
    const markdown = page.locator(".assistant-streamdown").filter({ hasText: "Markdown 主题检查" })
    await expect(markdown).toBeVisible()
    await expect(markdown.locator('[data-streamdown="code-block-body"] span[style]').first()).toBeVisible()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      await expect(markdown).toBeVisible()
      const result = await markdown.evaluate((node) => {
        const document = node.ownerDocument
        const window = document.defaultView!
        const style = window.getComputedStyle(node)
        const foreground = style.getPropertyValue("--foreground").trim()
        const temp = document.createElement("span"); temp.style.color = foreground; node.append(temp)
        const expected = window.getComputedStyle(temp).color; temp.remove()
        const color = (selector: string) => window.getComputedStyle(node.querySelector(selector)!).color
        return {
          body: style.color, expected,
          heading: color("h1"), code: color('[data-streamdown="inline-code"]'),
          h1Size: parseFloat(window.getComputedStyle(node.querySelector("h1")!).fontSize),
          h2Size: parseFloat(window.getComputedStyle(node.querySelector("h2")!).fontSize),
          headingMargin: parseFloat(window.getComputedStyle(node.querySelector("h2")!).marginTop),
          overflow: node.scrollWidth - node.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          table: !!node.querySelector("table"),
        }
      })
      expect(result.body).toBe(result.expected)
      expect(result.heading).toBe(result.expected)
      expect(result.code).toBe(result.expected)
      expect(result.h1Size).toBeGreaterThan(result.h2Size)
      expect(result.headingMargin).toBeGreaterThanOrEqual(16)
      expect(result.overflow).toBeLessThanOrEqual(1)
      expect(result.pageOverflow).toBeLessThanOrEqual(1)
      expect(result.table).toBe(true)
      await markdown.locator("h1").scrollIntoViewIfNeeded()
      await testInfo.attach(`markdown-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
    }
    expect(observation.pageErrors).toEqual([])
    expect(observation.consoleErrors).toEqual([])
  })
}
