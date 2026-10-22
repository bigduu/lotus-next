import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { markdownThemeFixture } from "./support/markdownThemeFixture.js"

const accents = ["teal", "blue", "purple", "green", "rose", "orange", "#ffffff", "#000000"]

function luminance(color: string): number {
  const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
  const channels = values.map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

for (const theme of ["light", "dark"] as const) {
  test(`subtle surfaces and keyboard focus remain readable in ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "one paired-theme viewport and accent regression")
    test.setTimeout(120_000)
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
    await page.addInitScript((mode) => {
      localStorage.setItem("bodhi_onboarded_v1", "1")
      localStorage.setItem("copilot_ui_theme_v1", mode)
    }, theme)
    const observation = await installArtifactRuntime(page, standaloneScenario, [{
      role: "assistant", content: markdownThemeFixture, timestamp: "2026-09-03T00:00:00.000Z",
    }])
    await page.goto(standaloneScenario.entryUrl)

    const palette = []
    for (const accent of accents) {
      await page.evaluate((value) => {
        localStorage.setItem("lotus_global_accent_color_v1", JSON.stringify({
          preset: value.startsWith("#") ? "custom" : value,
          custom: value.startsWith("#") ? value : "#396957",
        }))
      }, accent)
      await page.reload()
      const composer = page.getByRole("textbox", { name: "消息", exact: true }).first()
      await expect(composer).toBeVisible()
      await page.keyboard.press("Tab")
      await composer.focus()
      await expect(composer).toBeFocused()

      const result = await page.locator("html").evaluate((rootNode) => {
        const document = rootNode.ownerDocument
        const browser = document.defaultView!
        const root = browser.getComputedStyle(document.documentElement)
        const probe = document.createElement("span")
        probe.style.transitionProperty = "none"
        document.body.append(probe)
        const resolve = (token: string) => {
          probe.style.color = root.getPropertyValue(token)
          return browser.getComputedStyle(probe).color
        }
        const colors = Object.fromEntries([
          "--background", "--card", "--popover", "--sidebar", "--foreground",
          "--muted-foreground", "--focus-ring", "--focus-surface",
        ].map((token) => [token, resolve(token)]))
        probe.remove()
        const surface = document.querySelector("[data-composer-surface]")!
        const surfaceStyle = browser.getComputedStyle(surface)
        return {
          colors,
          focusVisible: !!surface.querySelector(".composer-editor:focus-visible"),
          shadow: surfaceStyle.boxShadow,
          background: surfaceStyle.backgroundColor,
          editorShadow: browser.getComputedStyle(surface.querySelector(".composer-editor")!).boxShadow,
          border: surfaceStyle.borderTopColor,
        }
      })
      expect(result.focusVisible).toBe(true)
      expect(result.shadow).toContain("4px")
      expect(result.shadow).toContain("7px")
      expect(result.editorShadow).toBe("none")
      expect(result.background).toBe(result.colors["--focus-surface"])
      expect(result.border).toBe("rgba(0, 0, 0, 0)")
      for (const surface of ["--background", "--card", "--popover", "--sidebar", "--focus-surface"]) {
        expect(contrast(result.colors["--focus-ring"], result.colors[surface]), `${accent} focus on ${surface}`).toBeGreaterThanOrEqual(3)
        expect(contrast(result.colors["--foreground"], result.colors[surface]), `${accent} text on ${surface}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(result.colors["--muted-foreground"], result.colors[surface]), `${accent} muted text on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      palette.push({ accent, ...result })

      const modelPicker = page.getByTestId("model-effort-picker").first()
      await modelPicker.focus()
      expect(await modelPicker.evaluate((element) => element.matches(":focus-visible"))).toBe(true)
      expect(await modelPicker.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).boxShadow)).toContain("4px")

      if (accent === "teal") {
        await composer.focus()
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1100 })
          await expect(composer).toBeVisible()
          await expect(page.locator(".assistant-streamdown")).toContainText("Markdown 主题检查")
          expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.ownerDocument.defaultView!.innerWidth)).toBeLessThanOrEqual(1)
          await info.attach(`surfaces-${theme}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
        }
        await page.setViewportSize({ width: 1440, height: 1100 })
        const session = await page.context().newCDPSession(page)
        await session.send("DOM.enable")
        await session.send("CSS.enable")
        const { root } = await session.send("DOM.getDocument")
        const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".assistant-streamdown p" })
        const fonts = await session.send("CSS.getPlatformFontsForNode", { nodeId })
        await info.attach(`actual-system-fonts-${theme}`, { body: JSON.stringify(fonts, null, 2), contentType: "application/json" })
        await session.detach()
        await modelPicker.press("Enter")
        await page.getByTestId("model-picker-model").press("Enter")
        const modelSearch = page.getByRole("searchbox", { name: "搜索模型", exact: true })
        await modelSearch.focus()
        await expect(modelSearch).toBeFocused()
        // Input transitions its shadow; assert the settled visible cue.
        await expect(modelSearch).toHaveCSS("box-shadow", /4px/)
        const option = page.locator(".model-effort-panel [data-model-option]:enabled").first()
        await option.focus()
        await expect(option).toBeFocused()
        expect(await option.evaluate((element) => element.matches(":focus-visible"))).toBe(true)
        await expect(option).toHaveCSS("box-shadow", /4px/)
        await expect(option).toHaveCSS("outline-color", result.colors["--focus-ring"])
        await expect(option).toHaveCSS("outline-offset", "-2px")
        await page.keyboard.press("Escape")
      }

      const newSession = page.getByRole("button", { name: "新建会话", exact: true })
      await page.keyboard.press("Tab")
      await newSession.focus()
      expect(await newSession.evaluate((element) => element.matches(":focus-visible"))).toBe(true)
      expect(await newSession.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).boxShadow)).toContain("4px")
    }
    await info.attach(`focus-contrast-${theme}`, { body: JSON.stringify(palette, null, 2), contentType: "application/json" })
    await page.emulateMedia({ forcedColors: "active" })
    const composer = page.getByRole("textbox", { name: "消息", exact: true }).first()
    await composer.focus()
    const forcedSurface = await page.locator("[data-composer-surface]").first().evaluate((surface) => {
      const style = surface.ownerDocument.defaultView!.getComputedStyle(surface)
      return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) }
    })
    expect(forcedSurface).toEqual({ outlineStyle: "solid", outlineWidth: 2 })
    const newSession = page.getByRole("button", { name: "新建会话", exact: true })
    await page.keyboard.press("Tab")
    await newSession.focus()
    expect(await newSession.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).outlineStyle)).toBe("solid")
    expect(await newSession.evaluate((element) => parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2)

    await page.emulateMedia({ forcedColors: "none" })
    await page.getByRole("button", { name: "系统设置", exact: true }).click()
    const settingsNav = page.locator(".settings-nav-item").first()
    await expect(settingsNav).toBeVisible()
    await page.keyboard.press("Tab")
    await settingsNav.focus()
    expect(await settingsNav.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).boxShadow)).toContain("4px")
    await page.emulateMedia({ forcedColors: "active" })
    await settingsNav.focus()
    await expect(settingsNav).toHaveCSS("outline-style", "solid")
    await expect(settingsNav).toHaveCSS("outline-width", "2px")
    await page.setViewportSize({ width: 390, height: 1100 })
    const settingsCategory = page.locator("#settings-category")
    await settingsCategory.focus()
    await expect(settingsCategory).toHaveCSS("outline-style", "solid")
    await expect(settingsCategory).toHaveCSS("outline-width", "2px")
    expect(observation.consoleErrors).toEqual([])
    expect(observation.pageErrors).toEqual([])
  })
}
