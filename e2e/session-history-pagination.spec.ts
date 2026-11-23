import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
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

async function prepareHistory(page: Page, paginated: boolean, phone = false, olderResources?: Promise<void>) {
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const messages = Array.from({ length: olderResources ? 105 : paginated ? 2005 : 2 }, (_, index) => {
    const row = {
      id: `history-${index === 1904 ? 1905 : index}`, role: "user",
      content: index === 1904 ? archivedContent : `Transcript message ${index}`,
      created_at: at, ...(index === 1904 ? { compressed: true, compressed_by_event_id: "compact-1" } : {}),
    }
    if (!olderResources) return row
    if (index === 0) return { ...row, content_parts: [
      { type: "image_url", image_url: { url: `bamboo-attachment://${id}/archived.png` } },
    ] }
    if (index === 1) return { ...row, role: "assistant", content: "", tool_calls: [
      { id: "archive-edit", type: "function", function: { name: "Edit", arguments: "{}" } },
    ] }
    if (index === 2) return { ...row, role: "tool", tool_call_id: "archive-edit", content: JSON.stringify({
      operation: "edit", file_path: "/fixture/src/older.ts", diff: { unified: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+restored" },
    }) }
    return row
  })
  if (olderResources) {
    await page.route(`**/api/v1/sessions/${id}/attachments/archived.png`, (route) => route.fulfill({
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9EoAAAAASUVORK5CYII=", "base64"),
    }))
  }
  const calls: Array<{ accept?: string; before: string | null; limit: string | null }> = []
  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [{ ...session, message_count: messages.length }], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  await page.route(`**/api/v1/task/${id}`, (route) => route.fulfill({ json: { session_id: id, items: [] } }))
  await page.route(`**/api/v1/respond/${id}/pending`, (route) => route.fulfill({ json: { has_pending_question: false } }))
  await page.route((url) => url.pathname === `/api/v1/history/${id}`, async (route) => {
    const params = new URL(route.request().url()).searchParams
    const before = params.get("before_message_id")
    calls.push({ accept: route.request().headers().accept, before, limit: params.get("limit") })
    if (!paginated) return route.fulfill({ json: { session_id: id, messages } })
    if (before && olderResources) await olderResources
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

test("exports unopened compressed history without expanding the displayed transcript", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop download menu")
  const { calls } = await prepareHistory(page, true)
  await expect(page.getByText("Transcript message 2004", { exact: true })).toBeVisible()
  expect(calls.every((call) => call.before === null)).toBe(true)
  const scroller = page.locator("[data-message-list-content]").locator("..")
  const before = await scroller.evaluate((element) => element.scrollTop)
  await page.getByRole("button", { name: "更多", exact: true }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "导出 Markdown", exact: true }).click()
  const text = await readFile(await (await download).path(), "utf8")
  expect(text).toContain("Transcript message 0\n")
  expect(text).toContain(archivedContent)
  expect(text).toContain("Transcript message 2004\n")
  expect(text.indexOf("Transcript message 0\n")).toBeLessThan(text.indexOf(archivedContent))
  expect(text.indexOf(archivedContent)).toBeLessThan(text.indexOf("Transcript message 2004\n"))
  expect(calls.filter((call) => call.before !== null)).toHaveLength(20)
  await expect(page.getByText(archivedContent, { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: olderLabel, exact: true })).toHaveCount(1)
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
})

test("loads an older edit and attachment on demand for Environment and Review from one prefix", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop Environment and Review")
  await page.setViewportSize({ width: 1900, height: 900 })
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const { calls } = await prepareHistory(page, true, false, held)
  await expect(page.getByText("Transcript message 104", { exact: true })).toBeVisible()
  const environment = page.getByRole("region", { name: "Environment" })
  const loadSources = environment.getByRole("button", { name: "加载更早的来源", exact: true })
  await expect(loadSources).toBeVisible()
  expect(calls.every((call) => call.before === null)).toBe(true)
  const changes = environment.getByRole("button", { name: /Changes/ })
  try {
    await loadSources.click()
    await expect(environment.getByRole("status")).toContainText("正在加载更早的对话历史")
    await expect(changes).toHaveText("Changes")
    await expect.poll(() => calls.filter((call) => call.before !== null)).toHaveLength(1)
  } finally {
    release()
  }
  await expect(environment.getByRole("button", { name: "预览 attachment-archived.png" })).toBeVisible()
  await expect(changes).toContainText("1 个变更文件")
  const evidence = testInfo.outputPath("recovered-history-sources.png")
  await environment.screenshot({ path: evidence, animations: "disabled" })
  await testInfo.attach("Recovered history sources", { path: evidence, contentType: "image/png" })
  await changes.click()
  await expect(page.locator("#right-workbench").getByText("older.ts", { exact: false }).first()).toBeVisible()
  expect(calls.filter((call) => call.before !== null)).toHaveLength(1)
  await expect(page.getByText("Transcript message 0", { exact: true })).toHaveCount(0)
})
