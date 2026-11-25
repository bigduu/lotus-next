import { expect, test, type Locator } from "@playwright/test"
import { artifactFileForSource, installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const invalid = "flowchart LR\nA[Broken --> B[Done]"
const repaired = "flowchart LR\nA[Repaired] -->|请求| B[Done]"
const documentSource = [
  "# 单张 Mermaid 修复检查",
  "前后正文应保留，图表可以分别编辑。",
  "```mermaid\nflowchart LR\nA[Sibling] -->|请求| B[Unchanged]\n```",
  `\`\`\`mermaid\n${invalid}\n\`\`\``,
  "尾部正文保持原样。",
].join("\n\n")

const recoveryDiagrams = [
  "flowchart LR\nA[First diagram] -->|请求| B[Done]",
  "flowchart LR\nA[Second diagram] -->|请求| B[Done]",
] as const
const recoveryContent = ["Mermaid module recovery", ...recoveryDiagrams.map((source) => `\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n")

function diagramImage(figure: Locator) {
  return figure.getByRole("img", { name: "Mermaid 图表", exact: true })
}

async function inspectDiagram(figure: Locator) {
  const image = diagramImage(figure)
  await expect(image).toBeVisible()
  await expect(image).toHaveAttribute("src", /^blob:/)
  await expect(figure.locator("svg")).toHaveCount(0)
  await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  return image.evaluate(async (node) => {
    const img = node as HTMLImageElement
    const document = img.ownerDocument
    // Measure the actual image in its own SVG document. Disable scripts in the fixture viewer.
    const frame = document.createElement("iframe")
    frame.setAttribute("sandbox", "allow-same-origin")
    frame.style.cssText = "position:fixed;left:-10000px;width:1000px;height:1000px;visibility:hidden"
    const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve() })
    frame.src = img.currentSrc
    try {
      document.body.append(frame)
      await loaded
      const svg = frame.contentDocument!.querySelector("svg")!
      const imageWindow = frame.contentWindow!
      const view = svg.viewBox.baseVal
      const content = svg.getBBox()
      const labels = Array.from(svg.querySelectorAll("text"))
      const edgeLabel = labels.find((label) => label.textContent?.trim() === "请求")!
      return {
        view: { x: view.x, y: view.y, width: view.width, height: view.height },
        content: { x: content.x, y: content.y, width: content.width, height: content.height },
        labels: labels.map((label) => label.textContent?.trim()),
        paint: {
          label: imageWindow.getComputedStyle(edgeLabel).fill,
          line: imageWindow.getComputedStyle(svg.querySelector(".flowchart-link")!).stroke,
          background: document.defaultView!.getComputedStyle(img.parentElement!).backgroundColor,
        },
      }
    } finally {
      frame.remove()
    }
  })
}

for (const permanentFailure of [false, true]) {
  test(permanentFailure ? "Mermaid module recovery stops after persistent failures" : "Mermaid recovers a missing module in place", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "Focused built Mermaid module recovery")
    const [original, alternate] = await Promise.all([
      artifactFileForSource("src/solid/markdown/renderMermaid.ts"),
      artifactFileForSource("src/solid/markdown/recoverMermaidRenderer.ts"),
    ])
    expect(original).not.toBe(alternate)
    await page.addInitScript(() => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("lotus_next_last_session", "all-surface-session")
    })
    const observation = await installArtifactRuntime(page, standaloneScenario, [{
      id: "diagram-module-recovery", role: "assistant", content: recoveryContent, created_at: "2026-10-24T00:00:00Z",
    }])
    const requests: string[] = []
    await page.route((url) => url.pathname === `/${original}` || url.pathname === `/${alternate}`, async (route) => {
      const asset = new URL(route.request().url()).pathname.slice(1)
      requests.push(asset)
      if (asset === original || permanentFailure) {
        if (permanentFailure && asset === alternate && requests.length === 4) {
          // A slow failure may outlast the shared preload reload cooldown.
          await new Promise<void>((resolve) => setTimeout(resolve, 10_100))
        }
        return route.fulfill({ status: 404, headers: { "cache-control": "no-store" } })
      }
      return route.fallback()
    })
    let navigations = 0
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1 })
    await page.goto(standaloneScenario.entryUrl, { waitUntil: "domcontentloaded" })

    const markdown = page.locator(".assistant-streamdown").filter({ hasText: "Mermaid module recovery" })
    const diagrams = markdown.locator("figure[data-mermaid-state]")
    if (permanentFailure) {
      await expect.poll(() => navigations).toBe(2)
      await expect(diagrams).toHaveCount(2)
      for (const [index, source] of recoveryDiagrams.entries()) {
        const diagram = diagrams.nth(index)
        await expect(diagram).toHaveAttribute("data-mermaid-state", "error", { timeout: 15_000 })
        await expect(diagram.locator("[data-mermaid-source]")).toHaveText(source)
        await expect(diagram.getByRole("button", { name: "重新渲染", exact: true })).toBeEnabled()
      }
      expect(requests).toEqual([original, alternate, original, alternate])
      expect(navigations).toBe(2)
    } else {
      await expect(diagrams).toHaveCount(2)
      for (const [index, source] of recoveryDiagrams.entries()) {
        const diagram = diagrams.nth(index)
        await expect(diagram).toHaveAttribute("data-mermaid-state", "ready")
        expect((await inspectDiagram(diagram)).labels).toContain(index === 0 ? "First diagram" : "Second diagram")
        await diagram.getByRole("button", { name: "编辑源码", exact: true }).click()
        const editor = diagram.getByRole("textbox", { name: "Mermaid 源码", exact: true })
        await expect(editor).toHaveValue(`${source}\n`)
        await editor.press("Escape")
      }
      expect(requests).toEqual([original, alternate])
      expect(navigations).toBe(1)
    }
    expect(observation.httpRequests.filter((request) => ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
      && !request.url.endsWith("/provider-catalog/fetch-models"))).toEqual([])
    expect(observation.pageErrors).toEqual([])
  })
}

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
      const strayError = page.locator("svg").filter({ hasText: "Syntax error in text" })
      await expect(sibling).toHaveAttribute("data-mermaid-state", "ready")
      await expect(target).toHaveAttribute("data-mermaid-state", "error")
      await expect(strayError).toHaveCount(0)
      const siblingImage = await diagramImage(sibling).getAttribute("src")
      const bounds = await inspectDiagram(sibling)
      expect(bounds.labels).toContain("Sibling")
      expect(bounds.content.x).toBeGreaterThanOrEqual(bounds.view.x - 0.5)
      expect(bounds.content.y).toBeGreaterThanOrEqual(bounds.view.y - 0.5)
      expect(bounds.content.x + bounds.content.width).toBeLessThanOrEqual(bounds.view.x + bounds.view.width + 0.5)
      expect(bounds.content.y + bounds.content.height).toBeLessThanOrEqual(bounds.view.y + bounds.view.height + 0.5)
      const colors = bounds.paint
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
      await expect(strayError).toHaveCount(0)
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
      expect((await inspectDiagram(target)).labels).toContain("Repaired")
      await expect(target.getByRole("button", { name: "编辑源码", exact: true })).toBeFocused()
      await expect(diagramImage(sibling)).toHaveAttribute("src", siblingImage!)
      await expect(markdown).toContainText("尾部正文保持原样。")
      expect(await markdown.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
      const readyFile = info.outputPath(`mermaid-repaired-${theme}-${width}.png`)
      await target.screenshot({ path: readyFile, animations: "disabled" })
      await info.attach("Repaired diagram", { path: readyFile, contentType: "image/png" })
      if (width === 1440) {
        const oldSrc = await diagramImage(target).getAttribute("src")
        await page.getByRole("button", { name: "系统设置", exact: true }).click()
        await page.getByRole("button", { name: theme === "light" ? "深色" : "浅色", exact: true }).click()
        await page.getByRole("button", { name: "返回聊天", exact: true }).click()
        await expect(target).toHaveAttribute("data-mermaid-state", "ready")
        expect((await inspectDiagram(target)).labels).toContain("Repaired")
        await expect(diagramImage(target)).not.toHaveAttribute("src", oldSrc!)
      }
      await target.getByRole("button", { name: "编辑源码", exact: true }).click()
      await editor.fill("Discard this unsaved source")
      await editor.press("Escape")
      await expect(editor).toHaveCount(0)
      expect((await inspectDiagram(target)).labels).toContain("Repaired")
      await target.getByRole("button", { name: "还原原图", exact: true }).click()
      await expect(target).toHaveAttribute("data-mermaid-state", "error")
      await expect(target.locator("[data-mermaid-source]")).toHaveText(invalid)
      await expect(strayError).toHaveCount(0)
      expect(observation.staticUrls.some((url) => /\/recoverMermaidRenderer-[^/]+\.js$/.test(url))).toBe(false)
      expect(observation.httpRequests.filter((request) => ["POST", "PATCH", "PUT", "DELETE"].includes(request.method)
        && !request.url.endsWith("/provider-catalog/fetch-models"))).toEqual([])
      expect(observation.pageErrors).toEqual([])
    })
  }
}
