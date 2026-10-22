import { expect, test } from "@playwright/test"
import { THEME_COLORS } from "../src/shared/theme/colorTokens.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test.describe("CSS color fallback before application bootstrap", () => {
  test.use({ javaScriptEnabled: false })

  for (const mode of ["light", "dark"] as const) {
    test(`serves complete ${mode} semantic colors and live compatibility aliases without JavaScript`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-chromium", "CSS contract does not depend on viewport")
      await installArtifactRuntime(page, standaloneScenario)
      await page.goto(standaloneScenario.entryUrl)
      await expect(page.locator("#root")).toBeEmpty()
      const expected = THEME_COLORS[mode]
      const result = await page.locator("html").evaluate((root, input) => {
        root.classList.toggle("dark", input.mode === "dark")
        const browser = root.ownerDocument.defaultView!
        const probe = root.ownerDocument.createElement("span")
        root.ownerDocument.body.append(probe)
        const resolve = (value: string) => {
          probe.style.color = value
          return browser.getComputedStyle(probe).color
        }
        const colors = Object.fromEntries(Object.entries(input.expected).map(([name, value]) => [name, {
          present: browser.getComputedStyle(root).getPropertyValue(`--${name}`).trim() !== "",
          actual: resolve(`var(--${name})`),
          expected: resolve(value),
        }]))
        const background = browser.getComputedStyle(root.ownerDocument.body).backgroundColor
        const expectedBackground = resolve(input.expected.background)
        // Aliases must stay reactive to an existing user/host override. Fixed
        // focus colors must remain legible even when --primary becomes black.
        root.style.setProperty("--primary", "#000000")
        root.style.setProperty("--primary-foreground", "#ffffff")
        const overridden = {
          sidebar: resolve("var(--sidebar-primary)"),
          sidebarText: resolve("var(--sidebar-primary-foreground)"),
          focus: resolve("var(--focus-ring)"),
          expectedFocus: resolve(input.expected["focus-ring"]),
        }
        probe.remove()
        return { colors, background, expectedBackground, overridden }
      }, { mode, expected })
      for (const [name, color] of Object.entries(result.colors)) {
        expect(color.present, name).toBe(true)
        expect(color.actual, name).toBe(color.expected)
      }
      expect(result.background).toBe(result.expectedBackground)
      expect(result.overridden.sidebar).toBe("rgb(0, 0, 0)")
      expect(result.overridden.sidebarText).toBe("rgb(255, 255, 255)")
      expect(result.overridden.focus).toBe(result.overridden.expectedFocus)
      await info.attach(`pre-bootstrap-${mode}-colors`, {
        body: JSON.stringify(result, null, 2), contentType: "application/json",
      })
    })
  }
})
