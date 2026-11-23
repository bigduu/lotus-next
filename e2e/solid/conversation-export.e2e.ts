import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

const id = "all-surface-session"
const title = "中文会话导出"
const at = "2026-09-03T00:00:00.000Z"
const engineChunk = /\/assets\/renderPdf-[^/?]+\.js$/
const session = {
  id, title, title_version: 1, kind: "root", session_version: 2, root_session_id: id,
  created_at: at, updated_at: at, last_activity_at: at, is_running: false, message_count: 3,
  model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
  root_orchestration_only: false, thinking_mode: "standard", root_mode_transition_epoch: 1,
  root_mode_birth_token: "a".repeat(64), permission_mode: "default", last_run_status: "completed",
  execution_compatibility: { status: "compatible", session_version: 2, current_session_version: 2, execution_allowed: true, history_readable: true, conflicts: [] },
}
type MessageFixture = { role: "user" | "assistant"; content: string; id: string; created_at: string }
const message = (id: string, role: MessageFixture["role"], content: string): MessageFixture => ({ id, role, content, created_at: at })

async function fixture(page: Page, baseURL: string | undefined, messages: readonly MessageFixture[], paginated = false) {
  const entry = new URL("/", baseURL)
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_ui_locale_v1", "en-US")
    localStorage.setItem("lotus_next_last_session", id)
  }, id)
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: entry.origin, entryUrl: entry.href,
  }, [], { serveStaticFromLocalServer: true })
  await page.route((url) => url.pathname === "/api/v1/sessions", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind")
    const sessions = kind === "child" ? [] : [session]
    return route.fulfill({ json: { sessions, total: sessions.length, limit: 200, offset: 0 } })
  })
  await page.route(`**/api/v1/sessions/${id}`, (route) => route.fulfill({ json: { session }, headers: { ETag: '"1"' } }))
  const reads: Array<string | null> = []
  await page.route((url) => url.pathname === `/api/v1/history/${id}`, (route) => {
    const before = new URL(route.request().url()).searchParams.get("before_message_id")
    reads.push(before)
    if (!paginated) return route.fulfill({ json: { session_id: id, messages } })
    const firstVisible = messages.length - 1
    return route.fulfill({ json: {
      session_id: id, messages: before ? messages.slice(0, firstVisible) : messages.slice(firstVisible),
      is_delta: false, history_start_index: before ? 0 : firstVisible,
      total_message_count: messages.length, next_before_message_id: before ? null : "earlier-fixture",
    } })
  })
  const open = async () => {
    await page.goto(entry.href)
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  }
  return { open, reads, observation }
}

async function selectExport(page: Page, format: "Markdown" | "PDF") {
  await page.getByRole("banner").getByRole("button", { name: "More", exact: true }).click()
  await page.getByRole("menuitem", { name: `Export as ${format}`, exact: true }).click()
}

test("downloads the exact complete Markdown without expanding displayed history", async ({ page, baseURL }) => {
  const messages = [message("earlier-user", "user", "较早的问题"), message("earlier-reply", "assistant", "**较早回复**"),
    message("latest", "user", "最近一条消息")]
  const { open, reads, observation } = await fixture(page, baseURL, messages, true)
  await open()
  await expect(page.getByText("最近一条消息", { exact: true })).toBeVisible()
  expect(reads.filter(Boolean)).toEqual([])
  const download = page.waitForEvent("download")
  await selectExport(page, "Markdown")
  const result = await download
  expect(result.suggestedFilename()).toBe(`${title}.md`)
  const path = await result.path()
  expect(await readFile(path!, "utf8")).toBe(
    `# ${title}\n\n## User\n\n较早的问题\n\n## Assistant\n\n**较早回复**\n\n## User\n\n最近一条消息\n`,
  )
  expect(reads.filter(Boolean)).toEqual(["earlier-fixture"])
  await expect(page.getByText("较早的问题", { exact: true })).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
})

test("lazily exports CJK and a wide Mermaid diagram as a mixed-orientation PDF", async ({ page, baseURL }, testInfo) => {
  const diagram = Array.from({ length: 12 }, (_, index) => `N${index}["处理阶段 ${index + 1}"]`).join(" --> ")
  const markdown = [
    "**中文排版**保留标题、段落与表格。", "", "| 步骤 | 结果 |", "| --- | --- |", "| 准备 | 完成 |", "",
    "- 第一项", "- 第二项", "", "[安全检查](javascript:fixture)", "",
    "\x60\x60\x60mermaid", "flowchart LR", diagram, "\x60\x60\x60", "",
    "这是图表之后的内容。",
  ].join("\n")
  const { open, observation } = await fixture(page, baseURL, [
    message("question", "user", "请为这段对话生成 PDF。"),
    message("report", "assistant", markdown),
  ])
  let loaded = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(engineChunk, async (route) => { loaded += 1; await gate; await route.continue() })
  await open()
  await expect(page.getByText("这是图表之后的内容。", { exact: true })).toBeVisible()
  expect(loaded).toBe(0)
  const download = page.waitForEvent("download")
  try {
    await selectExport(page, "PDF")
    await expect(page.locator("[data-pdf-export-overlay]").getByRole("status")).toHaveText("Exporting PDF…")
    await expect.poll(() => loaded).toBe(1)
  } finally { release() }

  const result = await download
  expect(result.suggestedFilename()).toBe(`${title}.pdf`)
  const output = testInfo.outputPath("conversation.pdf")
  await result.saveAs(output)
  const pdf = await readFile(output)
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  const structure = pdf.toString("latin1")
  const dimensions = [...structure.matchAll(/\/MediaBox\s*\[0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map(([, width, height]) => Number(width) < Number(height) ? "portrait" : "landscape")
  expect(dimensions).toEqual(["portrait", "landscape", "portrait"])
  expect(structure.match(/\/Subtype\s*\/Image\b/g)?.length).toBeGreaterThanOrEqual(3)
  await expect(page.locator("[data-pdf-export-overlay], [data-pdf-export-document]")).toHaveCount(0)
  expect(observation.pageErrors).toEqual([])
  await testInfo.attach("conversation.pdf", { path: output, contentType: "application/pdf" })
})

test("keeps PDF download failures local and dismissible", async ({ page, baseURL }) => {
  const { open, observation } = await fixture(page, baseURL, [message("question", "user", "Export fixture")])
  await page.addInitScript(() => {
    const encodeCanvas = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
      if (type === "image/jpeg") throw new Error("Fixture canvas unavailable")
      return encodeCanvas.call(this, type, quality)
    }
  })
  await open()
  await expect(page.getByText("Export fixture", { exact: true })).toBeVisible()
  await selectExport(page, "PDF")
  const overlay = page.locator("[data-pdf-export-overlay]")
  await expect(overlay.getByRole("alert")).toContainText("Could not export PDF")
  await overlay.click({ position: { x: 1, y: 1 } })
  await expect(overlay).toHaveCount(0)
  await expect(page.getByText("Export fixture", { exact: true })).toBeVisible()
  expect(observation.pageErrors).toEqual([])
})
