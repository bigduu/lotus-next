import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

test("assistant local image fallback and ViewImage preview remain usable at narrow width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop image preview screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const bytes = await readFile(fileURLToPath(new URL("../src/assets/hero.png", import.meta.url)))
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`
  const sessionId = "inline-image-session"
  const session = {
    id: sessionId, title: "Image previews", kind: "root", model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-24T00:00:00Z", updated_at: "2026-09-24T00:00:04Z",
    permission_mode: "default", is_running: false,
  }
  const history = [
    { id: "user-image", role: "user", content: "Show the image", created_at: "2026-09-24T00:00:00Z" },
    { id: "assistant-image", role: "assistant", content: "Local example: ![diagram](/Users/example/diagram.png)", created_at: "2026-09-24T00:00:01Z" },
    {
      id: "assistant-call", role: "assistant", content: "",
      tool_calls: [{ id: "image-call", type: "function", function: { name: "view_image", arguments: '{"path":"/tmp/hero.png"}' } }],
      created_at: "2026-09-24T00:00:02Z",
    },
    { id: "tool-image", role: "tool", tool_call_id: "image-call", content: "Image opened",
      content_parts: [{ type: "image_url", image_url: { url: dataUrl } }],
      created_at: "2026-09-24T00:00:03Z" },
  ]

  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({ json: { sessions: [session], total: 1, limit: 200, offset: 0 } }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  await page.route(`**/api/v1/history/${sessionId}`, (route) => route.fulfill({ json: { session_id: sessionId, messages: history } }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({ json: { session_id: sessionId, items: [] } }))
  await page.route(`**/api/v1/respond/${sessionId}/pending`, (route) => route.fulfill({ json: { has_pending_question: false } }))

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "Image previews", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "本地图片无法在此处预览" })).toBeVisible()
  expect(observation.httpRequests.some(({ url }) => url.includes("/Users/example/diagram.png"))).toBe(false)

  await page.locator("[data-tool-call-toggle]").click()
  const row = page.locator("[data-tool-call-entry-toggle]")
  await expect(row).toContainText("查看图片")
  await expect(page.locator("[data-tool-call-entry-detail] img")).toHaveCount(0)
  await row.click()
  const image = page.locator("[data-tool-call-entry-detail] img")
  await expect(image).toHaveAttribute("src", dataUrl)
  await expect(image).toBeVisible()
  const wideScreenshot = testInfo.outputPath("view-image-wide.png")
  await page.screenshot({ path: wideScreenshot, animations: "disabled" })
  await testInfo.attach("ViewImage expanded preview", { path: wideScreenshot, contentType: "image/png" })

  await image.locator("..").click()
  await expect(page.getByRole("button", { name: "关闭预览" })).toBeVisible()
  await page.getByRole("button", { name: "关闭预览" }).click()
  await page.setViewportSize({ width: 760, height: 720 })
  await expect(image).toBeVisible()
  const dimensions = await image.evaluate((element) => ({ image: element.getBoundingClientRect().width, viewport: element.ownerDocument.defaultView?.innerWidth ?? 0 }))
  expect(dimensions.image).toBeLessThan(dimensions.viewport)
  const narrowScreenshot = testInfo.outputPath("view-image-narrow.png")
  await page.screenshot({ path: narrowScreenshot, animations: "disabled" })
  await testInfo.attach("Narrow ViewImage preview", { path: narrowScreenshot, contentType: "image/png" })

  // Reopen the same transcript with a Bodhi bridge to exercise the real
  // Markdown -> host adapter -> native command -> thumbnail wiring.
  await page.addInitScript((imageDataUrl) => {
    const host = globalThis as typeof globalThis & {
      __TAURI_INTERNALS__?: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
      __imageReadCalls?: Array<{ command: string; path: unknown }>
    }
    host.__imageReadCalls = []
    host.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        if (command === "read_local_image") {
          host.__imageReadCalls?.push({ command, path: args?.path })
          return imageDataUrl
        }
        return null
      },
    }
  }, dataUrl)
  await page.setViewportSize({ width: 1_440, height: 900 })
  await page.reload()
  await page.getByRole("button", { name: "Image previews", exact: true }).click()
  const localImage = page.locator('[data-message-role="assistant"] img[data-streamdown="image"]')
  await expect(localImage).toHaveAttribute("src", dataUrl)
  const nativeCalls = await page.evaluate(() => (globalThis as typeof globalThis & {
    __imageReadCalls?: Array<{ command: string; path: unknown }>
  }).__imageReadCalls)
  expect(nativeCalls).toEqual([{ command: "read_local_image", path: "/Users/example/diagram.png" }])
  const nativeScreenshot = testInfo.outputPath("bodhi-inline-image.png")
  await page.screenshot({ path: nativeScreenshot, animations: "disabled" })
  await testInfo.attach("Bodhi inline image", { path: nativeScreenshot, contentType: "image/png" })

  history[1].content = "Windows example: ![diagram](file:///C:/Users/example/diagram.png)"
  await page.reload()
  await page.getByRole("button", { name: "Image previews", exact: true }).click()
  await expect(page.locator('[data-message-role="assistant"] img[data-streamdown="image"]')).toHaveAttribute("src", dataUrl)
  const windowsCalls = await page.evaluate(() => (globalThis as typeof globalThis & {
    __imageReadCalls?: Array<{ command: string; path: unknown }>
  }).__imageReadCalls)
  expect(windowsCalls).toEqual([{ command: "read_local_image", path: "C:/Users/example/diagram.png" }])

  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
