import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const id = "long-transcript"
const at = "2026-11-23T00:00:00Z"
const olderLabel = "加载更早消息"
const archivedContent = "Original text from the compressed part of the conversation"
const cursorAt = (index: number) => `page/${index}`
const session = {
  id, title: "Conversation history", kind: "root", root_session_id: id, model: "fixture-model",
  model_ref: { provider: "fixture-provider", model: "fixture-model" }, created_at: at, updated_at: at,
  permission_mode: "default", is_running: false,
}

async function prepareHistory(page: Page, paginated: boolean, phone = false) {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const messages = Array.from({ length: paginated ? 2005 : 2 }, (_, index) => ({
    id: `history-${index === 1904 ? 1905 : index}`, role: "user",
    content: index === 1904 ? archivedContent : `Transcript message ${index}`,
    created_at: at, ...(index === 1904 ? { compressed: true, compressed_by_event_id: "compact-1" } : {}),
  }))
  const calls: Array<{ accept?: string; before: string | null; limit: string | null }> = []
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [{ ...session, message_count: messages.length }], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  await page.route(`**/api/v1/task/${id}`, (route) => route.fulfill({ json: { session_id: id, items: [] } }))
  await page.route(`**/api/v1/respond/${id}/pending`, (route) => route.fulfill({ json: { has_pending_question: false } }))
  await page.route((url) => url.pathname === `/api/v1/history/${id}`, (route) => {
    const params = new URL(route.request().url()).searchParams
    const before = params.get("before_message_id")
    calls.push({ accept: route.request().headers().accept, before, limit: params.get("limit") })
    if (!paginated) return route.fulfill({ json: { session_id: id, messages } })
    const end = before ? Number(before.split("/")[1]) : messages.length
    const start = Math.max(0, end - 100)
    return route.fulfill({ json: {
      session_id: id, messages: messages.slice(start, end), is_delta: false, total_message_count: messages.length,
      history_start_index: start, next_before_message_id: start ? cursorAt(start) : null,
    } })
  })
  await page.goto(standaloneScenario.entryUrl)
  if (phone) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: session.title, exact: true }).click()
  return { calls, observation }
}

test("opens a recent page and keeps its reading position when compressed history is prepended", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop reading position")
  const { calls, observation } = await prepareHistory(page, true)
  await expect(page.getByText("Transcript message 2004", { exact: true })).toBeVisible()
  expect(calls[0]).toEqual({ accept: "application/json; bamboo-history-limit=100", before: null, limit: null })
  await expect(page.getByText(archivedContent, { exact: true })).toHaveCount(0)

  const scroller = page.locator("[data-message-list-content]").locator("..")
  const load = page.getByRole("button", { name: olderLabel, exact: true })
  await scroller.hover()
  await page.mouse.wheel(0, -100_000)
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(load).toBeInViewport()
  const control = testInfo.outputPath("load-earlier-messages.png")
  await scroller.screenshot({ path: control, animations: "disabled" })
  await testInfo.attach("Load earlier messages", { path: control, contentType: "image/png" })
  const anchor = page.getByText("Transcript message 1905", { exact: true })
  await expect(anchor).toBeInViewport()
  const readingY = (await anchor.boundingBox())!.y
  await load.click()
  await expect.poll(() => calls.find((call) => call.before !== null)).toMatchObject({ before: cursorAt(1905), limit: "100" })
  await expect.poll(async () => Math.abs(((await anchor.boundingBox())?.y ?? -1000) - readingY)).toBeLessThan(24)
  await scroller.hover()
  await page.mouse.wheel(0, -320)
  await expect(page.getByText(archivedContent, { exact: true })).toBeInViewport()
  await expect(anchor).toBeInViewport()
  const screenshot = testInfo.outputPath("recovered-history.png")
  await scroller.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Recovered compressed history", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})

test("keeps the unpaged transcript when the producer ignores the initial page preference", async ({ page }, testInfo) => {
  const { calls } = await prepareHistory(page, false, testInfo.project.name === "phone-chromium")
  await expect(page.getByText("Transcript message 0", { exact: true })).toBeVisible()
  await expect(page.getByText("Transcript message 1", { exact: true })).toBeVisible()
  expect(calls[0]?.accept).toBe("application/json; bamboo-history-limit=100")
  await expect(page.getByRole("button", { name: olderLabel, exact: true })).toHaveCount(0)
  expect(calls.every((call) => call.before === null)).toBe(true)
})
