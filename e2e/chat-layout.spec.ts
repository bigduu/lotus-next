import { expect, test, type Locator, type Page } from "@playwright/test"
import { actorSnapshotFixture } from "../src/test/fixtures/actorSnapshot.js"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { openProcessActivities } from "./support/processActivity.js"

const mainId = "all-surface-session"
const sideId = "layout-side"
const childId = "layout-child"
const at = "2026-10-06T00:00:00.000Z"

function session(id: string, title: string, child = false) {
  return {
    id, title, title_version: 1, kind: child ? "child" : "root", pinned: false,
    parent_session_id: child ? mainId : null, root_session_id: child ? mainId : id,
    spawn_depth: child ? 1 : 0, model: "fixture-model",
    model_ref: { provider: "fixture-provider", model: "fixture-model" },
    created_at: at, updated_at: at, last_activity_at: at, message_count: 4,
    subagent_count: id === mainId ? 1 : 0, is_running: false,
    last_run_status: "stopped", permission_mode: "default", bypass_permissions: false,
    root_orchestration_only: false, thinking_mode: "standard", reasoning_effort: "medium",
    root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64),
  }
}

const sessions = [session(mainId, "Layout main"), session(sideId, "Layout side"), session(childId, "Layout child", true)]

function history(id: string) {
  return [
    { id: `${id}-user`, role: "user", content: "A quiet, aligned conversation.", created_at: at },
    { id: `${id}-answer`, role: "assistant", content: "Assistant baseline.", reasoning: "Check the same reading column.", metadata: { reasoning: "Check the same reading column." }, created_at: at },
    {
      id: `${id}-call`, role: "assistant", content: "", created_at: at,
      tool_calls: [{ id: `${id}-read`, function: { name: "Read", arguments: JSON.stringify({ file_path: "/tmp/layout.md" }) } }],
    },
    { id: `${id}-result`, role: "tool", tool_call_id: `${id}-read`, content: "Read complete.", created_at: at },
  ]
}

async function openLayout(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", "all-surface-session")
  })
  const observation = await installArtifactRuntime(page, standaloneScenario)
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === "/api/v1/sessions") {
      const kind = url.searchParams.get("kind")
      const root = url.searchParams.get("root_session_id")
      const selected = sessions.filter((item) => (!kind || item.kind === kind) && (!root || item.root_session_id === root))
      return route.fulfill({ json: { sessions: selected, total: selected.length, limit: 200, offset: 0 } })
    }
    const selected = sessions.find((item) => path === `/api/v1/sessions/${item.id}`)
    if (selected) return route.fulfill({ json: { session: selected }, headers: { ETag: '"1"' } })
    const historySession = sessions.find((item) => path === `/api/v1/history/${item.id}`)
    if (historySession) return route.fulfill({ json: { session_id: historySession.id, messages: history(historySession.id) } })
    if (path === `/api/v1/sessions/${childId}/history`) {
      const messages = history(childId).slice(0, 2).map(({ id, role, content, created_at }) => ({ id, role, content, created_at }))
      return route.fulfill({ json: { session_id: childId, projection: "messages", is_delta: false, truncated: false, total_message_count: messages.length, messages } })
    }
    const actor = sessions.find((item) => path === `/api/v1/actors/${item.id}/snapshot`)
    if (actor) return route.fulfill({ json: actorSnapshotFixture(actor.id, 0) })
    if (sessions.some((item) => path === `/api/v1/task/${item.id}`)) return route.fulfill({ json: { items: [] } })
    if (sessions.some((item) => path === `/api/v1/respond/${item.id}/pending`)) return route.fulfill({ json: { has_pending_question: false } })
    await route.fallback()
  })
  await page.goto(standaloneScenario.entryUrl)
  await expect(page.locator("[data-message-list-content]").first()).toContainText("Assistant baseline.")
  return observation
}

async function expectDisclosureAlignment(scope: Locator) {
  await openProcessActivities(scope)
  const tool = scope.locator("[data-tool-call-entry-heading]").first()
  const reasoning = scope.locator("[data-reasoning-toggle]").first()
  await expect(tool).toBeVisible()
  await expect(scope.locator("[data-tool-call-toggle], [data-tool-call-entry-toggle]")).toHaveCount(0)
  await expect(scope.locator("[data-tool-call-entry-detail]")).toBeVisible()
  await expect(scope.locator("[data-tool-call-entry-detail]")).toContainText("Read complete.")
  await expect(reasoning).toBeVisible()
  await expect(scope.locator('[data-message-role="assistant"] p').first()).toBeVisible()
  const edges = await scope.evaluate((element) => {
    const tool = element.querySelector("[data-tool-call-entry-heading]")!
    const reasoning = element.querySelector("[data-reasoning-toggle]")!
    return {
      processIcon: element.querySelector("[data-process-toggle] svg")!.getBoundingClientRect().left,
      toolIcon: tool.querySelector("svg")!.getBoundingClientRect().left,
      reasoningIcon: reasoning.querySelector("svg")!.getBoundingClientRect().left,
      toolLabel: tool.querySelector("span")!.getBoundingClientRect().left,
      reasoningLabel: reasoning.querySelector("span")!.getBoundingClientRect().left,
      body: element.querySelector('[data-message-role="assistant"] p')!.getBoundingClientRect().left,
    }
  })
  expect(Math.abs(edges.processIcon - edges.body)).toBeLessThanOrEqual(1)
  expect(Math.abs(edges.toolIcon - edges.reasoningIcon)).toBeLessThanOrEqual(1)
  expect(Math.abs(edges.toolLabel - edges.reasoningLabel)).toBeLessThanOrEqual(1)
  expect(Math.abs(edges.toolIcon - edges.body)).toBeLessThanOrEqual(1)
}

async function expectComposerAlignment(scope: Locator) {
  // Read one browser frame so an in-progress shared transition cannot be
  // mistaken for misalignment by sampling the two columns at different times.
  const edges = await scope.evaluate((element) => {
    const transcript = element.querySelector("[data-message-list-content]")!.getBoundingClientRect()
    const composer = element.querySelector("[data-composer-surface]")!.getBoundingClientRect()
    const input = element.querySelector('[data-composer-editor]')!
    const style = element.ownerDocument.defaultView!.getComputedStyle(input)
    return {
      transcriptWidth: transcript.width, composerWidth: composer.width,
      transcriptLeft: transcript.left, composerLeft: composer.left,
      textLeft: input.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      bodyLeft: element.querySelector('[data-message-role="assistant"] p')!.getBoundingClientRect().left,
    }
  })
  expect(Math.abs(edges.transcriptWidth - edges.composerWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(edges.transcriptLeft - edges.composerLeft)).toBeLessThanOrEqual(1)
  expect(Math.abs(edges.textLeft - edges.bodyLeft)).toBeLessThanOrEqual(1.1)
  return edges.composerLeft + edges.composerWidth / 2
}

test("chat tools, reasoning, body, and composer share reading edges on every viewport", async ({ page }, testInfo) => {
  const observation = await openLayout(page)
  // Close the phone drawer before measuring the underlying conversation.
  if (testInfo.project.name === "phone-chromium") await page.keyboard.press("Escape")
  const main = page.locator("[data-chat-layout]").first()
  await expectDisclosureAlignment(main)
  await expectComposerAlignment(main)
  await expect(main.locator('[data-message-role="user"]')).toHaveClass(/user-message-surface/)
  const screenshot = testInfo.outputPath("aligned-conversation.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Aligned conversation", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})

test("Environment moves the transcript, input content, and reading control together", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "wide and constrained desktop Environment geometry")
  await openLayout(page)
  const main = page.locator("[data-chat-layout]").first()
  const floating = main.locator("[data-environment-floating]")
  // Give the manual preference ownership before resizing across the auto-show
  // breakpoint, so a changing accessible label cannot race the click.
  await page.getByRole("button", { name: "打开 Environment", exact: true }).click()
  await page.getByRole("button", { name: "收起 Environment", exact: true }).click()
  for (const width of [1900, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole("button", { name: "打开 Environment", exact: true }).click()
    await expect(floating).toHaveAttribute("data-state", "open")
    const expectedShift = await main.evaluate((element) => Math.max(-166, Math.min(0, (1152 - element.getBoundingClientRect().width) / 2)))
    await expect.poll(() => main.locator("[data-composer-column]").evaluate((element) => parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).left))).toBe(expectedShift)
    const shiftedCenter = await expectComposerAlignment(main)
    await expectDisclosureAlignment(main)
    await page.getByRole("button", { name: "收起 Environment", exact: true }).click()
    await expect(floating).toHaveAttribute("data-state", "closed")
    await expect.poll(() => main.locator("[data-composer-column]").evaluate((element) => parseFloat(element.ownerDocument.defaultView!.getComputedStyle(element).left))).toBe(0)
    const centered = await expectComposerAlignment(main)
    expect(Math.abs(centered - shiftedCenter + expectedShift)).toBeLessThanOrEqual(1)
  }
  // Grow the transcript while pinned, then perform actual reader input.
  await page.setViewportSize({ width: 1900, height: 900 })
  await main.locator("[data-message-list-content]").evaluate((element) => {
    const spacer = element.ownerDocument.createElement("div")
    spacer.style.height = "1200px"
    element.append(spacer)
  })
  const viewport = main.locator("[data-message-list-content]").locator("..")
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2)
  await viewport.hover()
  await page.mouse.wheel(0, -240)
  const jump = main.getByRole("button", { name: "滚动到底部", exact: true })
  await expect(jump).toBeVisible()
  await page.getByRole("button", { name: "打开 Environment", exact: true }).click()
  await expect.poll(async () => {
    const control = (await jump.boundingBox())!
    const input = (await main.locator("[data-composer-surface]").boundingBox())!
    return Math.abs(control.x + control.width / 2 - input.x - input.width / 2)
  }).toBeLessThanOrEqual(1)
  const screenshot = testInfo.outputPath("environment-reading-column.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Environment reading column", { path: screenshot, contentType: "image/png" })
})

test("interactive side chat and child transcript retain the shared reading column", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "desktop secondary surfaces")
  const observation = await openLayout(page)
  await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: /并排会话.*打开另一个会话/ }).click()
  await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
  await page.getByRole("option", { name: "Layout side", exact: true }).click()
  await expectDisclosureAlignment(workbench)
  await expectComposerAlignment(workbench)
  await page.getByRole("button", { name: /Layout child/ }).click()
  const child = workbench.locator("[data-subagent-transcript-pane]")
  await expect(child.locator('[data-message-role="assistant"] p')).toHaveText("Assistant baseline.")
  const childTextInset = await child.evaluate((element) =>
    element.querySelector('[data-message-role="assistant"] p')!.getBoundingClientRect().left
    - element.querySelector("[data-message-list-content]")!.getBoundingClientRect().left,
  )
  expect(childTextInset).toBe(14)
  await expect(child.locator('[data-message-role="user"]')).toHaveClass(/user-message-surface/)
  await expect(child.locator("[data-process-toggle], [data-tool-call-toggle], [data-tool-call-entry], [data-reasoning-toggle]")).toHaveCount(0)
  await expect(child.getByRole("textbox", { name: "消息", exact: true })).toHaveCount(0)
  const screenshot = testInfo.outputPath("child-transcript-baseline.png")
  await page.screenshot({ path: screenshot, animations: "disabled" })
  await testInfo.attach("Child transcript baseline", { path: screenshot, contentType: "image/png" })
  expect(observation.pageErrors).toEqual([])
})
