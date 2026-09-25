import { expect, test } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"

const parentId = "all-surface-session"
const otherRootId = "side-root"
const childId = "side-child"
const at = "2026-09-22T00:00:00.000Z"

const session = (id: string, kind: "root" | "child", title: string) => ({
  id, title, title_version: 1, kind, pinned: false,
  parent_session_id: kind === "child" ? parentId : null,
  root_session_id: kind === "child" ? parentId : id,
  spawn_depth: kind === "child" ? 1 : 0,
  model: "fixture-model",
  model_ref: { provider: "fixture-provider", model: "fixture-model" },
  created_at: at, updated_at: at, last_activity_at: at,
  message_count: 1, subagent_count: id === parentId ? 1 : 0,
  is_running: false, last_run_status: "completed",
  permission_mode: "default", bypass_permissions: false,
})

const sessions = [
  session(parentId, "root", "All-surface acceptance"),
  session(otherRootId, "root", "Other root"),
  session(childId, "child", "Preview child"),
]

const asFrame = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null

test("split root remains interactive while child uses only projected history and channel", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop split-pane acceptance")
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, standaloneScenario)
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (request.method() === "GET" && path === "/api/v1/sessions") {
      const kind = url.searchParams.get("kind")
      const root = url.searchParams.get("root_session_id")
      const selected = sessions.filter((item) => (!kind || item.kind === kind)
        && (!root || item.root_session_id === root))
      await route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    } else if (request.method() === "GET" && path === `/api/v1/sessions/${otherRootId}`) {
      await route.fulfill({ json: { session: sessions[1] }, headers: { ETag: '"1"' } })
    } else if (request.method() === "GET" && path === `/api/v1/sessions/${childId}`) {
      await route.fulfill({ json: { session: sessions[2] }, headers: { ETag: '"1"' } })
    } else if (request.method() === "GET" && path === `/api/v1/history/${otherRootId}`) {
      await route.fulfill({ json: { session_id: otherRootId, messages: [
        { id: "root-message", role: "user", content: "root history", created_at: at },
      ] } })
    } else if (request.method() === "GET" && path === `/api/v1/history/${parentId}`) {
      await route.fulfill({ json: { session_id: parentId, messages: [
        { id: "spawn-tool", role: "assistant", content: "", created_at: at,
          tool_calls: [{ id: "spawn-call", function: { name: "SubAgent", arguments: "{}" } }] },
      ] } })
    } else if (request.method() === "GET" && path === `/api/v1/sessions/${childId}/history`
      && url.searchParams.get("projection") === "messages") {
      await route.fulfill({ json: {
        session_id: childId, projection: "messages", is_delta: false,
        truncated: false, total_message_count: 2,
        messages: [
          { id: "child-user", role: "user", content: "child question", created_at: at },
          { id: "child-answer", role: "assistant", content: "child answer", created_at: at },
        ],
      } })
    } else if (request.method() === "GET" && path === `/api/v1/task/${parentId}`) {
      await route.fulfill({ json: { session_id: parentId, items: [] } })
    } else if (request.method() === "GET" && path === `/api/v1/respond/${otherRootId}/pending`) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else if (request.method() === "GET" && path === `/api/v1/respond/${childId}/pending`) {
      await route.fulfill({ json: { has_pending_question: false } })
    } else {
      await route.fallback()
    }
  })

  await page.goto(standaloneScenario.entryUrl)
  await page.getByRole("button", { name: "All-surface acceptance", exact: true }).click()
  await page.getByRole("button", { name: "打开侧边面板" }).click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: "检查器" }).click()
  await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "并排会话" }).click()
  await workbench.getByRole("tab", { name: "并排会话" }).click()
  await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
  await page.getByRole("option", { name: "Other root" }).click()
  await expect(workbench.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await expect(workbench.getByText("root history")).toBeVisible()
  expect(requests.some((url) => new URL(url).pathname === `/api/v1/history/${otherRootId}`)).toBe(true)

  const rootComposer = workbench.getByRole("textbox", { name: "消息", exact: true })
  await rootComposer.fill("keep root draft across tabs")
  await workbench.getByRole("tab", { name: "检查器" }).click()
  await workbench.getByRole("tab", { name: "Other root" }).click()
  await expect(rootComposer).toHaveValue("keep root draft across tabs")
  await rootComposer.fill("")

  // The parent transcript's SubAgent tool group exposes the actual child-open action.
  await page.getByRole("button", { name: /Preview child/ }).click()
  await expect(workbench.locator("[data-subagent-transcript-pane]")).toBeVisible()
  await expect(workbench.getByText("child question")).toBeVisible()
  await expect(workbench.getByText("child answer")).toBeVisible()
  await expect(workbench.getByRole("textbox", { name: "消息", exact: true })).toHaveCount(0)
  await expect.poll(() => observation.clientFrames.some((value) => {
    const frame = asFrame(value)
    return frame?.type === "subscribe" && frame.ch === `message.${childId}`
  })).toBe(true)
  expect(observation.clientFrames.some((value) => {
    const frame = asFrame(value)
    return frame?.type === "subscribe" && frame.ch === `agent.${childId}`
  })).toBe(false)
  expect(requests.some((url) => new URL(url).pathname === `/api/v1/history/${childId}`)).toBe(false)
  expect(requests.some((requestUrl) => {
    const url = new URL(requestUrl)
    return url.pathname === `/api/v1/sessions/${childId}/history`
      && url.searchParams.get("projection") === "messages"
  })).toBe(true)

  await workbench.getByRole("tab", { name: "检查器" }).click()
  await expect.poll(() => observation.clientFrames.some((value) => {
    const frame = asFrame(value)
    return frame?.type === "unsubscribe" && frame.ch === `message.${childId}`
  })).toBe(true)
  await workbench.getByRole("tab", { name: "Preview child" }).click()
  await expect(workbench.getByText("child answer")).toBeVisible()

  await workbench.getByRole("combobox").filter({ hasText: "Preview child" }).click()
  await page.getByRole("option", { name: "Other root" }).click()
  await expect(workbench.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await expect(workbench.getByText("root history")).toBeVisible()
  await expect(workbench.locator("[data-subagent-transcript-pane]")).toHaveCount(0)
  await expect.poll(() => observation.clientFrames.some((value) => {
    const frame = asFrame(value)
    return frame?.type === "unsubscribe" && frame.ch === `message.${childId}`
  })).toBe(true)
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
  expect(observation.protocolErrors).toEqual([])
})
