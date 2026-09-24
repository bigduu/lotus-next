import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const sessionId = "tool-call-activity-session"

test("expanded tool groups show every compact call and reveal details on demand", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop tool activity screenshot")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const session = {
    id: sessionId,
    title: "Tool activity",
    kind: "root",
    model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:07Z",
    permission_mode: "default",
    is_running: false,
  }
  const calls = [
    { id: "read-1", name: "Read", arguments: { file_path: "/tmp/zenith/src/MessageList.tsx" } },
    { id: "bash-1", name: "Bash", arguments: { command: "npm run test:run -- ToolCalls.test.tsx" } },
    { id: "grep-1", name: "Grep", arguments: { query: "data-tool-call-toggle" } },
    { id: "image-1", name: "view_image", arguments: { path: "/tmp/zenith/tool-activity.png" } },
    { id: "read-2", name: "Read", arguments: { file_path: "/tmp/zenith/src/ToolCalls.tsx" } },
  ]
  const history = [
    { id: "user-activity", role: "user", content: "Show tool activity", created_at: "2026-09-24T00:00:00Z" },
    {
      id: "assistant-activity",
      role: "assistant",
      content: "",
      tool_calls: calls.map(({ id, name, arguments: params }) => ({
        id, type: "function", function: { name, arguments: JSON.stringify(params) },
      })),
      created_at: "2026-09-24T00:00:01Z",
    },
    ...calls.map(({ id }, index) => ({
      id: `result-${id}`,
      role: "tool",
      tool_call_id: id,
      content: `completed ${index + 1}`,
      created_at: `2026-09-24T00:00:0${index + 2}Z`,
    })),
  ]

  await page.route("**/api/v1/sessions?*", (route) => route.fulfill({
    json: { sessions: [session], total: 1, limit: 200, offset: 0 },
  }))
  await page.route(`**/api/v1/sessions/${sessionId}`, (route) => route.fulfill({
    json: { session }, headers: { ETag: '"1"' },
  }))
  await page.route(`**/api/v1/history/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, messages: history },
  }))
  await page.route(`**/api/v1/task/${sessionId}`, (route) => route.fulfill({
    json: { session_id: sessionId, items: [] },
  }))
  await page.route(`**/api/v1/respond/${sessionId}/pending`, (route) => route.fulfill({
    json: { has_pending_question: false },
  }))

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "Tool activity", exact: true }).click()

  const group = page.locator("[data-tool-call-toggle]")
  await expect(group).toHaveAttribute("aria-expanded", "false")
  await expect(group).toContainText("5 项操作")
  await group.focus()
  await page.keyboard.press("Enter")
  await expect(group).toHaveAttribute("aria-expanded", "true")

  const rows = page.locator("[data-tool-call-entry-toggle]")
  await expect(rows).toHaveCount(calls.length)
  await expect(page.getByText(/展开更早的/)).toHaveCount(0)
  await expect(page.locator("[data-tool-call-entry-detail]")).toHaveCount(0)
  for (const [index, detail] of ["MessageList.tsx", "npm run test:run", "data-tool-call-toggle", "tool-activity.png", "ToolCalls.tsx"].entries()) {
    await expect(rows.nth(index)).toContainText(detail)
  }

  await page.locator("body").click({ position: { x: 900, y: 400 } })
  const screenshot = testInfo.outputPath("all-tool-calls-collapsed-details.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("All compact tool calls", { path: screenshot, contentType: "image/png" })

  await rows.first().focus()
  await page.keyboard.press("Enter")
  await expect(rows.first()).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator("[data-tool-call-entry-detail]")).toHaveCount(1)
  await expect(page.locator("[data-tool-call-entry-detail]")).toContainText("/tmp/zenith/src/MessageList.tsx")
  await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "false")

  await page.setViewportSize({ width: 760, height: 720 })
  await expect(rows).toHaveCount(calls.length)
  await expect(rows.first()).toHaveAttribute("aria-expanded", "true")
  const panelWidth = await page.locator("[data-tool-call-panel]").evaluate((element) => ({
    content: element.scrollWidth,
    viewport: element.clientWidth,
  }))
  expect(panelWidth.content).toBeLessThanOrEqual(panelWidth.viewport + 1)
  const narrowScreenshot = testInfo.outputPath("narrow-tool-calls.png")
  await page.screenshot({ path: narrowScreenshot, animations: "disabled" })
  await testInfo.attach("Narrow tool calls", { path: narrowScreenshot, contentType: "image/png" })

  expect(observation.pageErrors).toEqual([])
  expect(observation.consoleErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})
