import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { surfaceMotion } from "../src/components/ui/motion.js"

// Exercise the production CSS cascade, including media-query specificity.
// jsdom does not implement :active or prefers-reduced-motion.
const assetDirectory = path.resolve("dist/assets")
const styles = readdirSync(assetDirectory)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(path.join(assetDirectory, name), "utf8"))
  .join("\n")

test("button press feedback respects reduced motion and disabled slotted controls", async ({ page }) => {
  await page.setContent(`<style>${styles}</style>
    <button class="button-interaction" style="margin:40px;width:120px;height:40px">Save</button>
    <a class="button-interaction" aria-disabled="true" style="display:inline-block;padding:20px">Unavailable</a>`)
  const button = page.getByRole("button", { name: "Save" })
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await button.hover()
  await page.mouse.down()
  await expect(button).toHaveCSS("transform", "matrix(0.98, 0, 0, 0.98, 0, 0)")
  await page.mouse.up()

  await page.emulateMedia({ reducedMotion: "reduce" })
  await button.hover()
  await page.mouse.down()
  await expect(button).toHaveCSS("transform", "none")
  await page.mouse.up()

  await page.emulateMedia({ reducedMotion: "no-preference" })
  const disabled = page.locator('[aria-disabled="true"]')
  await disabled.hover()
  await page.mouse.down()
  await expect(disabled).toHaveCSS("transform", "none")
  await page.mouse.up()
})

test("surface enter and exit share timing tokens and reduced motion removes animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.setContent(`<style>${styles}</style><div data-testid="surface" data-state="open"
    class="${surfaceMotion}">Menu</div>`)
  const surface = page.getByTestId("surface")
  await expect(surface).toHaveCSS("animation-duration", "0.22s")
  await expect(surface).toHaveCSS("animation-timing-function", "cubic-bezier(0.2, 0.8, 0.2, 1)")
  await surface.evaluate((el) => el.setAttribute("data-state", "closed"))
  await expect(surface).toHaveCSS("animation-duration", "0.14s")
  for (const state of ["delayed-open", "instant-open"]) {
    await surface.evaluate((el, value) => el.setAttribute("data-state", value), state)
    await expect(surface).toHaveCSS("animation-duration", "0.22s")
  }
  await surface.evaluate((el) => el.setAttribute("data-state", "closed"))
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(surface).toHaveCSS("animation-name", "none")
  await surface.evaluate((el) => el.setAttribute("data-state", "open"))
  await expect(surface).toHaveCSS("animation-name", "none")
})
