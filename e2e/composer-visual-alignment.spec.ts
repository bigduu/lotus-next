import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { expectComposerText, revealComposerSettings } from "./support/composer.js"

async function toolbarGeometry(page: Page) {
  return page.locator("[data-composer-surface]").evaluate((surface) => {
    const toolbar = surface.querySelector("[data-composer-toolbar]")!
    const editor = surface.querySelector("[data-composer-editor]")!
    const browser = surface.ownerDocument.defaultView!
    const styles = browser.getComputedStyle(editor)
    const rect = editor.getBoundingClientRect()
    const controls = [...toolbar.querySelectorAll("button")]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .map((element) => {
        const box = element.getBoundingClientRect()
        const css = browser.getComputedStyle(element)
        return {
          label: element.getAttribute("aria-label"), x: box.x, right: box.right,
          height: box.height, center: box.y + box.height / 2,
          font: css.fontSize, line: css.lineHeight,
          icons: [...element.querySelectorAll("svg")].map((icon) => {
            const bounds = icon.getBoundingClientRect()
            return {
              chevron: icon.classList.contains("lucide-chevron-down"),
              x: bounds.x, size: bounds.width, height: bounds.height,
              center: bounds.y + bounds.height / 2,
            }
          }),
        }
      })
    return {
      compact: surface.closest("[data-composer-column]")?.getAttribute("data-composer-compact") === "true",
      editor: { x: rect.x, width: rect.width, font: styles.fontSize, line: styles.lineHeight,
        left: Number.parseFloat(styles.paddingLeft), right: Number.parseFloat(styles.paddingRight) },
      surface: { x: surface.getBoundingClientRect().x, right: surface.getBoundingClientRect().right },
      controls,
    }
  })
}

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`streaming metadata preserves the editor and Stop contrast at ${width}px in ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-chromium", "explicit streaming viewport and theme matrix")
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript((theme) => {
        localStorage.setItem("bodhi_onboarded_v1", "1")
        localStorage.setItem("lotus_next_last_session", "all-surface-session")
        localStorage.setItem("copilot_ui_theme_v1", theme)
      }, theme)
      const observation = await installArtifactRuntime(page, standaloneScenario)
      let socket: WebSocketRoute | undefined
      let subscribed = false
      let seq = 0
      await page.routeWebSocket(/.*/, (ws) => {
        socket = ws
        ws.onMessage((raw) => {
          const frame = JSON.parse(String(raw))
          if (frame.type === "hello") ws.send(JSON.stringify({ type: "welcome" }))
          if (frame.type === "ping") ws.send(JSON.stringify({ type: "pong" }))
          if (frame.type === "subscribe" && frame.ch === "agent.all-surface-session") subscribed = true
        })
      })
      await page.route("**/api/v1/chat", (route) => route.fulfill({ json: { session_id: "all-surface-session", status: "success" } }))
      await page.route("**/api/v1/execute/all-surface-session", (route) => route.fulfill({ json: { status: "started", session_id: "all-surface-session" } }))
      await page.goto(standaloneScenario.entryUrl)
      await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
      const editor = page.getByRole("textbox", { name: "消息", exact: true })
      await expect(page.getByRole("combobox", { name: "权限模式", exact: true })).toBeEnabled()
      await editor.fill("Synthetic streaming alignment check")
      await page.getByRole("button", { name: "发送消息", exact: true }).click()
      await expect.poll(() => subscribed).toBe(true)
      const stop = page.getByRole("button", { name: "停止生成", exact: true })
      await expect(stop).toBeVisible()
      const draft = "流式输出期间保留这份草稿，并使用完整的输入宽度。".repeat(5)
      await editor.fill(draft)
      const before = await toolbarGeometry(page)
      const emit = (content: string) => socket!.send(JSON.stringify({
        ch: "agent.all-surface-session", seq: ++seq, event: { type: "token", content },
      }))
      emit("First synthetic sample. ")
      // The real estimator needs two arrivals at least 600ms apart.
      await page.waitForTimeout(700)
      emit("Second synthetic sample for output rate. ")
      const rate = page.locator("[data-output-rate]")
      await expect(rate).toBeVisible()
      expect(await rate.evaluate((element) => !!element.closest("[data-composer-toolbar]"))).toBe(true)
      const after = await toolbarGeometry(page)
      expect(after.editor).toEqual(before.editor)
      await expect(editor).toHaveText(draft)
      const contrast = await stop.evaluate((element) => {
        const icon = element.querySelector("svg")!
        const browser = element.ownerDocument.defaultView!
        const buttonStyle = browser.getComputedStyle(element)
        const iconStyle = browser.getComputedStyle(icon)
        return { foreground: buttonStyle.color, background: buttonStyle.backgroundColor, fill: iconStyle.fill }
      })
      expect(contrast.fill).toBe(contrast.foreground)
      expect(contrast.fill).not.toBe(contrast.background)
      for (const control of after.controls) {
        expect(control.height).toBe(32)
        expect(control.x).toBeGreaterThanOrEqual(after.surface.x)
        expect(control.right).toBeLessThanOrEqual(after.surface.right)
      }
      const file = info.outputPath(`streaming-toolbar-${width}-${theme}.png`)
      await page.locator("[data-composer-surface]").screenshot({ path: file, animations: "disabled" })
      await info.attach("Streaming toolbar", { path: file, contentType: "image/png" })
      expect(observation.pageErrors).toEqual([])
    })
  }
}

for (const width of [320, 390, 820, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`new-chat workspace control aligns at ${width}px in ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-chromium", "explicit new-chat viewport and theme matrix")
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript((theme) => {
        localStorage.setItem("bodhi_onboarded_v1", "1")
        localStorage.setItem("copilot_ui_theme_v1", theme)
        localStorage.setItem("lotus_ui_locale_v1", "zh-CN")
      }, theme)
      const observation = await installArtifactRuntime(page, standaloneScenario)
      await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [], total: 0, limit: 200, offset: 0 } }))
      await page.goto(standaloneScenario.entryUrl)
      await expect(page.getByTestId("home-dashboard")).toBeVisible()
      const editor = page.getByRole("textbox", { name: "消息", exact: true })
      const draft = "Keep this new-chat draft while inspecting its workspace."
      await editor.fill(draft)
      await revealComposerSettings(page)
      const workspace = page.getByRole("button", { name: "会话工作区", exact: true })
      await expect(workspace).toBeVisible()
      await expect.poll(async () => (await workspace.boundingBox())?.height).toBe(32)
      const geometry = await workspace.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const css = element.ownerDocument.defaultView!.getComputedStyle(element)
        const text = element.querySelector("span")!.getBoundingClientRect()
        return {
          height: box.height, center: box.y + box.height / 2, left: box.left, right: box.right,
          font: css.fontSize, line: css.lineHeight, textCenter: text.y + text.height / 2,
          icons: [...element.querySelectorAll("svg")].map((icon) => {
            const bounds = icon.getBoundingClientRect()
            return { size: bounds.width, height: bounds.height, center: bounds.y + bounds.height / 2 }
          }),
        }
      })
      expect(geometry.height).toBe(32)
      expect(geometry.font).toBe("14px")
      expect(geometry.line).toBe("20px")
      expect(geometry.textCenter).toBeCloseTo(geometry.center, 2)
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(width)
      expect(geometry.icons.map((icon) => icon.size)).toEqual([16, 12])
      for (const icon of geometry.icons) {
        expect(icon.height).toBe(icon.size)
        expect(icon.center).toBeCloseTo(geometry.center, 2)
      }
      await workspace.click()
      await expect(page.getByRole("dialog", { name: "会话工作区", exact: true })).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(workspace).toBeFocused()
      const more = page.getByRole("dialog", { name: "更多", exact: true })
      if (await more.isVisible()) await page.keyboard.press("Escape")
      await expectComposerText(editor, draft)
      expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      expect(observation.pageErrors).toEqual([])
    })

    test(`composer typography and icons align at ${width}px in ${theme}`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-chromium", "explicit viewport and theme matrix")
      const english = width === 390 || width === 1440
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript(({ theme, english }) => {
        localStorage.setItem("bodhi_onboarded_v1", "1")
        localStorage.setItem("lotus_next_last_session", "all-surface-session")
        localStorage.setItem("copilot_ui_theme_v1", theme)
        localStorage.setItem("lotus_ui_locale_v1", english ? "en-US" : "zh-CN")
      }, { theme, english })
      const observation = await installArtifactRuntime(page, standaloneScenario)
      await page.goto(standaloneScenario.entryUrl)
      await expect(page.getByRole("banner")).toContainText("All-surface acceptance")
      const permission = page.getByRole("combobox", { name: english ? "Permission mode" : "权限模式", exact: true })
      await expect(permission).toBeEnabled()
      const editor = page.getByRole("textbox", { name: english ? "Messages" : "消息", exact: true })
      await editor.fill("输入框和工具栏保持一致的对齐。Use the full input width. ".repeat(6))
      const model = page.getByTestId("model-effort-picker")
      const sendLabel = english ? "Send message" : "发送消息"
      await expect(page.getByRole("button", { name: sendLabel, exact: true })).toBeEnabled()
      const geometry = await toolbarGeometry(page)
      expect(geometry.editor.font).toBe("16px")
      expect(geometry.editor.line).toBe("24px")
      expect(geometry.editor.left).toBe(8)
      expect(geometry.editor.right).toBe(geometry.editor.left)
      const modelControl = geometry.controls.find((control) => control.label === (english ? "Model and reasoning effort" : "模型与推理强度"))!
      const send = geometry.controls.find((control) => control.label === sendLabel)!
      expect(modelControl).toBeDefined()
      expect(modelControl.center).toBeCloseTo(send.center, 2)
      for (const control of geometry.controls) {
        expect(control.height).toBe(32)
        expect(control.font).toBe("14px")
        expect(control.line).toBe("20px")
        expect(control.x).toBeGreaterThanOrEqual(geometry.surface.x)
        expect(control.right).toBeLessThanOrEqual(geometry.surface.right)
        for (const icon of control.icons) {
          expect(icon.size).toBe(icon.chevron ? 12 : 16)
          expect(icon.height).toBe(icon.size)
          expect(icon.center).toBeCloseTo(control.center, 2)
        }
      }
      const permissionControl = geometry.controls.find((control) => control.label === (english ? "Permission mode" : "权限模式"))!
      expect(permissionControl.icons[0].x).toBeCloseTo(geometry.editor.x + geometry.editor.left, 2)
      if (!geometry.compact) {
        expect(new Set(geometry.controls.map((control) => control.center)).size).toBe(1)
      } else {
        const more = page.getByRole("button", { name: english ? "More" : "更多", exact: true }).last()
        await more.click()
        const dialog = page.getByRole("dialog", { name: english ? "More" : "更多", exact: true })
        await expect(dialog.getByRole("button", { name: english ? "Add images" : "添加图片", exact: true })).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(more).toBeFocused()
      }
      await expect(editor).toHaveText("输入框和工具栏保持一致的对齐。Use the full input width. ".repeat(6).trimEnd())
      await model.click()
      await expect(page.getByRole("slider")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(model).toBeFocused()
      expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      const file = info.outputPath(`composer-${width}-${theme}.png`)
      await page.locator("[data-composer-surface]").screenshot({ path: file, animations: "disabled" })
      await info.attach("Composer typography and alignment", { path: file, contentType: "image/png" })
      expect(observation.pageErrors).toEqual([])
    })
  }
}
