import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const invalid = "flowchart LR\nA[Broken --> B[Done]"
const repaired = "flowchart LR\nA[Repaired] -->|请求| B[Done]"
const documentSource = [
  "# 单张 Mermaid 修复检查",
  "前后正文应保留，图表可以分别编辑。",
  "```mermaid\nflowchart LR\nA[Sibling] -->|请求| B[Unchanged]\n```",
  `\`\`\`mermaid\n${invalid}\n\`\`\``,
  "尾部正文保持原样。",
].join("\n\n")

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1440]) {
    test(`Mermaid repairs one diagram and follows ${theme} at ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-chromium", "explicit paired-theme viewport cases")
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
      await page.addInitScript((mode) => {
        localStorage.setItem("bodhi_onboarded_v1", "1")
        localStorage.setItem("copilot_ui_theme_v1", mode)
        localStorage.setItem("lotus_next_last_session", "all-surface-session")
      }, theme)
      const observation = await installArtifactRuntime(page, standaloneScenario, [{
        id: "diagram-repair", role: "assistant", content: documentSource, created_at: "2026-10-24T00:00:00Z",
      }])
      await page.goto(standaloneScenario.entryUrl)
      const markdown = page.locator(".assistant-streamdown").filter({ hasText: "单张 Mermaid 修复检查" })
      const figures = markdown.locator("figure[data-mermaid-state]")
      const sibling = figures.nth(0)
      const target = figures.nth(1)
      await expect(sibling).toHaveAttribute("data-mermaid-state", "ready")
      await expect(target).toHaveAttribute("data-mermaid-state", "error")
      const siblingSvg = await sibling.locator("svg").getAttribute("id")
      const bounds = await sibling.evaluate((figure) => {
        const svg = figure.querySelector("svg")!
        const view = svg.viewBox.baseVal
        const content = svg.getBBox()
        return { view: { x: view.x, y: view.y, width: view.width, height: view.height },
          content: { x: content.x, y: content.y, width: content.width, height: content.height } }
      })
      expect(bounds.content.x).toBeGreaterThanOrEqual(bounds.view.x - 0.5)
      expect(bounds.content.y).toBeGreaterThanOrEqual(bounds.view.y - 0.5)
      expect(bounds.content.x + bounds.content.width).toBeLessThanOrEqual(bounds.view.x + bounds.view.width + 0.5)
      expect(bounds.content.y + bounds.content.height).toBeLessThanOrEqual(bounds.view.y + bounds.view.height + 0.5)
      const colors = await sibling.evaluate((figure) => {
        const browser = figure.ownerDocument.defaultView!
        const svg = figure.querySelector("svg")!
        const label = [...svg.querySelectorAll("text")].find((node) => node.textContent === "请求")!
        return {
          label: browser.getComputedStyle(label).fill,
          line: browser.getComputedStyle(svg.querySelector(".flowchart-link")!).stroke,
          background: browser.getComputedStyle(figure.querySelector('[role="img"]')!).backgroundColor,
        }
      })
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
          const channel = Number(value) / 255
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        })
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const contrast = (color: string) => {
        const foreground = luminance(color), background = luminance(colors.background)
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
      }
      expect(contrast(colors.label)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.line)).toBeGreaterThanOrEqual(3)
      await target.locator("summary").click()
      await expect(target.locator("details pre")).toBeVisible()
      await expect(target.locator("details pre")).not.toHaveText("")
      await target.getByRole("button", { name: "重新渲染", exact: true }).click()
      await expect(target).toHaveAttribute("data-mermaid-state", "error")
      await target.getByRole("button", { name: "编辑源码", exact: true }).click()
      const editor = target.getByRole("textbox", { name: "Mermaid 源码", exact: true })
      await expect(editor).toBeFocused()
      await expect(editor).toHaveValue(`${invalid}\n`)
      await expect(target).toContainText("刷新后会还原")
      await editor.fill("")
      await expect(target.getByRole("button", { name: "渲染预览", exact: true })).toBeDisabled()
      await editor.fill(repaired)
      const editorFile = info.outputPath(`mermaid-editor-${theme}-${width}.png`)
      await target.screenshot({ path: editorFile, animations: "disabled" })
      await info.attach("Individual diagram source editor", { path: editorFile, contentType: "image/png" })
      await target.getByRole("button", { name: "渲染预览", exact: true }).click()
      await expect(target).toHaveAttribute("data-mermaid-state", "ready")
      await expect(target.getByRole("img")).toContainText("Repaired")
      await expect(target.getByRole("button", { name: "编辑源码", exact: true })).toBeFocused()
      expect(await sibling.locator("svg").getAttribute("id")).toBe(siblingSvg)
      await expect(markdown).toContainText("尾部正文保持原样。")
      expect(await markdown.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
      const readyFile = info.outputPath(`mermaid-repaired-${theme}-${width}.png`)
      await target.screenshot({ path: readyFile, animations: "disabled" })
      await info.attach("Repaired diagram", { path: readyFile, contentType: "image/png" })
      if (width === 1440) {
        const oldSvg = await target.locator("svg").getAttribute("id")
        await page.getByRole("button", { name: "系统设置", exact: true }).click()
        await page.getByRole("button", { name: theme === "light" ? "深色" : "浅色", exact: true }).click()
        await page.getByRole("button", { name: "返回聊天", exact: true }).click()
        await expect(target).toHaveAttribute("data-mermaid-state", "ready")
        await expect(target.getByRole("img")).toContainText("Repaired")
        expect(await target.locator("svg").getAttribute("id")).not.toBe(oldSvg)
      }
      await target.getByRole("button", { name: "编辑源码", exact: true }).click()
      await editor.fill("Discard this unsaved source")
      await editor.press("Escape")
      await expect(editor).toHaveCount(0)
      await expect(target.getByRole("img")).toContainText("Repaired")
      await target.getByRole("button", { name: "还原原图", exact: true }).click()
      await expect(target).toHaveAttribute("data-mermaid-state", "error")
      await expect(target.locator("[data-mermaid-source]")).toHaveText(invalid)
      expect(observation.httpRequests.filter((request) => ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
        && !request.url.endsWith("/provider-catalog/fetch-models"))).toEqual([])
      expect(observation.pageErrors).toEqual([])
    })
  }
}
